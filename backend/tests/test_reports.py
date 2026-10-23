"""Reports (task 10-23-actual-inspired, R7): grouped summaries that agree with the
dashboard, tags (with overlap), daily amounts and saved reports."""

from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope
from tests.test_refunds import leaves, match, store

URL = f"{API}/reports"


def seed(ledger: Ledger) -> dict[str, dict]:
    rows = store(
        ledger,
        [
            ledger.item(date="2026-08-03", amount="100", counterparty="盒马", note="#家"),
            ledger.item(
                date="2026-09-02",
                amount="300",
                counterparty="海底捞",
                category_id=ledger.dining,
                note="#国庆 #聚餐",
            ),
            ledger.item(date="2026-09-05", amount="50", counterparty="盒马"),
            ledger.item(
                date="2026-10-01",
                amount="-100",
                counterparty="海底捞",
                description="退",
                category_id=ledger.metro,
            ),
            ledger.item(
                date="2026-10-02", amount="6", counterparty="地铁", category_id=ledger.metro
            ),
        ],
    )
    names = ["groceries", "dinner", "groceries2", "refund", "metro"]
    return dict(zip(names, rows, strict=True))


def summary(client, group_by: str, **params) -> dict:
    query = {"group_by": group_by, "from_month": "2026-08", "to_month": "2026-10", **params}
    response = client.get(f"{URL}/summary", params=query)
    assert response.status_code == 200, response.text
    return response.json()


def test_level2_groups_equal_the_summaries(client, ledger):
    """AC13: a matched refund counts with its payment; per month and per category the
    figures are the month detail's."""
    rows = seed(ledger)
    match(client, rows["refund"], rows["dinner"]["id"])
    body = summary(client, "level2")
    assert body["months"] == ["2026-08", "2026-09", "2026-10"]
    by_key = {g["key"]: g for g in body["groups"]}
    for index, month in enumerate(body["months"]):
        detail = leaves(client, month)
        for category_id, (actual, _) in detail.items():
            group = by_key.get(str(category_id))
            assert (group["months"][index] if group else "0.00") == actual
    assert by_key[str(ledger.dining)]["amount"] == "200.00"
    assert by_key[str(ledger.dining)]["count"] == 1
    assert body["total"] == {
        "amount": "356.00",
        "count": 4,
        "months": ["100.00", "250.00", "6.00"],
    }
    assert [g["label"] for g in body["groups"]] == ["外食", "买菜", "地铁"]
    level1 = {g["label"]: g["amount"] for g in summary(client, "level1")["groups"]}
    assert level1 == {"餐饮": "350.00", "交通": "6.00"}


def test_tags_counterparties_and_channels(client, ledger):
    """AC13: a transaction with two tags is in both groups and the report says so."""
    rows = seed(ledger)
    match(client, rows["refund"], rows["dinner"]["id"])
    body = summary(client, "tag")
    groups = {g["key"]: (g["amount"], g["count"]) for g in body["groups"]}
    # The matched refund carries its payment's tags.
    assert groups == {
        "国庆": ("200.00", 1),
        "聚餐": ("200.00", 1),
        "家": ("100.00", 1),
        None: ("56.00", 2),
    }
    assert body["overlapping"] is True
    assert body["total"]["amount"] == "356.00"
    people = {g["key"]: g["amount"] for g in summary(client, "counterparty")["groups"]}
    assert people == {"海底捞": "200.00", "盒马": "150.00", "地铁": "6.00"}
    card = ledger.add_channel("信用卡")
    store(ledger, [ledger.item(date="2026-10-05", amount="9", counterparty="x")], card)
    channels = {g["label"]: g["amount"] for g in summary(client, "channel")["groups"]}
    assert channels == {"储蓄卡": "356.00", "信用卡": "9.00"}


def test_scope_and_range_limits(client, ledger):
    seed(ledger)
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    store(ledger, [ledger.item(date="2026-09-20", amount="3000", category_id=insurance)])
    everything = summary(client, "level2")
    # Annual accounts included; the unmatched refund counts on its own (in 地铁).
    assert everything["total"]["amount"] == "3356.00"
    only = summary(client, "level2", budget_account_id=yearly)
    assert [g["label"] for g in only["groups"]] == ["保险"]
    assert_envelope(
        client.get(
            f"{URL}/summary",
            params={"group_by": "tag", "from_month": "2026-10", "to_month": "2026-09"},
        ),
        422,
        "INVALID_MONTH_RANGE",
    )


def test_daily_amounts_add_up_to_the_month(client, ledger):
    """AC14: the days of a month add up to the dashboard's actual ("全部" = monthly
    accounts), with the month's budget."""
    rows = seed(ledger)
    match(client, rows["refund"], rows["dinner"]["id"])
    ledger.set_budgets("2026-09", {ledger.groceries: "500", ledger.dining: "800"})
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    store(ledger, [ledger.item(date="2026-09-20", amount="3000", category_id=insurance)])
    response = client.get(f"{URL}/daily", params={"from_month": "2026-09", "to_month": "2026-10"})
    body = response.json()
    september = [d for d in body["days"] if d["date"].startswith("2026-09")]
    # The refund dated 10-01 counts on its payment's day.
    assert september == [
        {"date": "2026-09-02", "amount": "200.00"},
        {"date": "2026-09-05", "amount": "50.00"},
    ]
    actual = client.get(f"{API}/summary/months/2026-09").json()["actual"]
    assert actual == "250.00"
    assert body["budgets"] == [
        {"month": "2026-09", "budget": "1300.00"},
        {"month": "2026-10", "budget": "1300.00"},
    ]


def test_saved_reports(client, ledger):
    """AC13: saved, renamed, overwritten and deleted; names are unique."""
    config = {
        "group_by": "tag",
        "mode": "total",
        "range": {"preset": "last_3"},
        "budget_account_id": None,
        "chart": "donut",
    }
    created = client.post(f"{URL}/saved", json={"name": "旅行标签", "config": config})
    assert created.status_code == 201, created.text
    report = created.json()
    assert report["config"]["range"] == {"preset": "last_3", "from_month": None, "to_month": None}
    assert_envelope(
        client.post(f"{URL}/saved", json={"name": "旅行标签", "config": config}),
        409,
        "REPORT_NAME_TAKEN",
    )
    custom = {**config, "range": {"preset": "custom"}}
    assert client.post(f"{URL}/saved", json={"name": "x", "config": custom}).status_code == 422
    renamed = client.patch(
        f"{URL}/saved/{report['id']}",
        json={"name": "标签", "config": {**config, "mode": "monthly", "chart": "bar"}},
    )
    assert renamed.json()["name"] == "标签"
    assert renamed.json()["config"]["chart"] == "bar"
    assert [r["name"] for r in client.get(f"{URL}/saved").json()] == ["标签"]
    assert client.delete(f"{URL}/saved/{report['id']}").status_code == 204
    assert client.get(f"{URL}/saved").json() == []
