"""Backend part of AC13 (summary endpoints), plus AC11/AC12 seen through the summaries."""

from datetime import date

from app.months import add_months, format_month
from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope


def _seed(ledger: Ledger) -> None:
    ledger.set_budgets("2026-07", {ledger.groceries: "1000", ledger.metro: "200"})
    ledger.set_budgets("2026-09", {ledger.groceries: "1200"})
    items = [
        ledger.item(date="2026-07-03", amount="300", counterparty="七月买菜"),
        ledger.item(date="2026-08-31", amount="410.10", counterparty="八月买菜"),
        ledger.item(date="2026-09-01", amount="500", counterparty="九月买菜"),
        ledger.item(date="2026-09-10", amount="-20", counterparty="九月买菜", description="退款"),
        ledger.item(
            date="2026-09-12", amount="260", counterparty="海底捞", category_id=ledger.dining
        ),
        ledger.item(
            date="2026-09-30", amount="88.80", counterparty="地铁", category_id=ledger.metro
        ),
    ]
    assert ledger.submit(items).status_code == 201


def test_month_detail_has_level1_rows_with_level2_children(client, ledger):
    """AC13: level-1 rows expand to level-2 rows; unbudgeted categories report null."""
    _seed(ledger)
    empty = ledger.category("居家")  # level 1 without children
    body = client.get(f"{ledger.base}/summary/months/2026-09").json()
    assert body == {
        "account_id": ledger.account_id,
        "currency": "CNY",
        "month": "2026-09",
        "budget": "1400.00",
        "actual": "828.80",
        "categories": [
            {
                "category_id": ledger.food,
                "name": "餐饮",
                "budget": "1200.00",  # sum of budgeted children only
                "actual": "740.00",
                "children": [
                    {
                        "category_id": ledger.groceries,
                        "name": "买菜",
                        "budget": "1200.00",
                        "actual": "480.00",
                    },
                    {
                        "category_id": ledger.dining,
                        "name": "外食",
                        "budget": None,
                        "actual": "260.00",
                    },
                ],
            },
            {
                "category_id": ledger.transport,
                "name": "交通",
                "budget": "200.00",
                "actual": "88.80",
                "children": [
                    {
                        "category_id": ledger.metro,
                        "name": "地铁",
                        "budget": "200.00",
                        "actual": "88.80",
                    },
                ],
            },
            {
                "category_id": empty,
                "name": "居家",
                "budget": None,
                "actual": "0.00",
                "children": [],
            },
        ],
    }
    # The share chart is drawn from level-1 actuals, which add up to the month total.
    assert sum(float(row["actual"]) for row in body["categories"]) == float(body["actual"])


def test_monthly_series_uses_the_budget_version_in_force(client, ledger):
    """AC13 monthly totals; AC12 with a budget change in the middle of the range."""
    _seed(ledger)
    body = client.get(f"{ledger.base}/summary/monthly", params={"from": "2026-06", "to": "2026-10"})
    assert body.status_code == 200
    assert body.json() == {
        "account_id": ledger.account_id,
        "currency": "CNY",
        "months": [
            {"month": "2026-06", "budget": None, "actual": "0.00"},  # before any budget
            {"month": "2026-07", "budget": "1200.00", "actual": "300.00"},
            {"month": "2026-08", "budget": "1200.00", "actual": "410.10"},
            {"month": "2026-09", "budget": "1400.00", "actual": "828.80"},
            {"month": "2026-10", "budget": "1400.00", "actual": "0.00"},  # carried forward
        ],
    }
    # Monthly totals agree with the month detail.
    for month in body.json()["months"]:
        detail = client.get(f"{ledger.base}/summary/months/{month['month']}").json()
        assert (detail["budget"], detail["actual"]) == (month["budget"], month["actual"])


def test_monthly_series_defaults_to_twelve_months(client, ledger):
    months = client.get(f"{ledger.base}/summary/monthly").json()["months"]
    this_month = date.today().replace(day=1)
    assert len(months) == 12
    assert months[-1]["month"] == format_month(this_month)
    assert months[0]["month"] == format_month(add_months(this_month, -11))

    ending = client.get(f"{ledger.base}/summary/monthly", params={"to": "2026-01"}).json()["months"]
    assert [m["month"] for m in ending][::11] == ["2025-02", "2026-01"]


def test_figures_are_per_account(client, ledger):
    """AC13: switching account changes all figures."""
    _seed(ledger)
    other = Ledger(client, name="美元账户", currency="USD")
    other.set_budgets("2026-09", {other.metro: "50"})
    assert (
        other.submit(
            [other.item(date="2026-09-05", amount="12", category_id=other.metro)]
        ).status_code
        == 201
    )

    detail = client.get(f"{other.base}/summary/months/2026-09").json()
    assert (detail["currency"], detail["budget"], detail["actual"]) == ("USD", "50.00", "12.00")
    monthly = client.get(
        f"{other.base}/summary/monthly", params={"from": "2026-09", "to": "2026-09"}
    )
    assert monthly.json()["months"] == [{"month": "2026-09", "budget": "50.00", "actual": "12.00"}]
    assert client.get(f"{ledger.base}/summary/months/2026-09").json()["actual"] == "828.80"


def test_summary_validation(client, ledger):
    url = f"{ledger.base}/summary/monthly"
    reversed_range = client.get(url, params={"from": "2026-10", "to": "2026-09"})
    assert_envelope(reversed_range, 422, "INVALID_MONTH_RANGE")
    too_long = client.get(url, params={"from": "2000-01", "to": "2026-09"})
    assert_envelope(too_long, 422, "INVALID_MONTH_RANGE")
    assert_envelope(client.get(url, params={"from": "2026/09"}), 422, "VALIDATION_ERROR")
    assert_envelope(client.get(f"{ledger.base}/summary/months/2026-9"), 422, "VALIDATION_ERROR")
    # The ends of the calendar are a rejected month, not a crash in month arithmetic.
    for path in (
        "summary/months/9999-12",
        "summary/monthly?to=9999-12",
        "summary/monthly?to=0001-01",
        "transactions?month=9999-12",
    ):
        assert_envelope(client.get(f"{ledger.base}/{path}"), 422, "INVALID_MONTH")
    assert_envelope(client.get(f"{API}/accounts/999/summary/monthly"), 404, "ACCOUNT_NOT_FOUND")
    assert_envelope(
        client.get(f"{API}/accounts/999/summary/months/2026-09"), 404, "ACCOUNT_NOT_FOUND"
    )
