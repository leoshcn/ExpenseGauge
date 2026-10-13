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
    body = client.get(f"{API}/summary/months/2026-09").json()
    assert body == {
        "budget_account_id": None,
        "currency": "CNY",
        "month": "2026-09",
        "budget": "1400.00",
        "actual": "828.80",
        "count": 3,  # payments; the unmatched refund is not one
        "annual_actual": "0.00",
        "categories": [
            {
                "category_id": ledger.food,
                "name": "餐饮",
                "budget": "1200.00",  # sum of budgeted children only
                "actual": "740.00",
                "count": 2,
                "children": [
                    {
                        "category_id": ledger.groceries,
                        "name": "买菜",
                        "budget": "1200.00",
                        "actual": "480.00",
                        "count": 1,
                    },
                    {
                        "category_id": ledger.dining,
                        "name": "外食",
                        "budget": None,
                        "actual": "260.00",
                        "count": 1,
                    },
                ],
            },
            {
                "category_id": ledger.transport,
                "name": "交通",
                "budget": "200.00",
                "actual": "88.80",
                "count": 1,
                "children": [
                    {
                        "category_id": ledger.metro,
                        "name": "地铁",
                        "budget": "200.00",
                        "actual": "88.80",
                        "count": 1,
                    },
                ],
            },
            {
                "category_id": empty,
                "name": "居家",
                "budget": None,
                "actual": "0.00",
                "count": 0,
                "children": [],
            },
        ],
    }
    # The share chart is drawn from level-1 actuals, which add up to the month total.
    assert sum(float(row["actual"]) for row in body["categories"]) == float(body["actual"])


def test_monthly_series_uses_the_budget_version_in_force(client, ledger):
    """AC13 monthly totals; AC12 with a budget change in the middle of the range."""
    _seed(ledger)
    body = client.get(f"{API}/summary/monthly", params={"from": "2026-06", "to": "2026-10"})
    assert body.status_code == 200
    assert body.json() == {
        "budget_account_id": None,
        "currency": "CNY",
        "months": [
            {
                "month": "2026-06",
                "budget": None,
                "actual": "0.00",
                "annual_actual": "0.00",
            },  # before any budget
            {"month": "2026-07", "budget": "1200.00", "actual": "300.00", "annual_actual": "0.00"},
            {"month": "2026-08", "budget": "1200.00", "actual": "410.10", "annual_actual": "0.00"},
            {"month": "2026-09", "budget": "1400.00", "actual": "828.80", "annual_actual": "0.00"},
            {
                "month": "2026-10",
                "budget": "1400.00",
                "actual": "0.00",
                "annual_actual": "0.00",
            },  # carried forward
        ],
    }
    # Monthly totals agree with the month detail.
    for month in body.json()["months"]:
        detail = client.get(f"{API}/summary/months/{month['month']}").json()
        assert (detail["budget"], detail["actual"]) == (month["budget"], month["actual"])


def _budgets(detail: dict) -> dict[int, str | None]:
    """Budget per category id (both levels) of a month detail."""
    rows = [row for level1 in detail["categories"] for row in (level1, *level1["children"])]
    return {row["category_id"]: row["budget"] for row in rows}


def test_cleared_budget_is_unbudgeted_from_its_month_in_both_summaries(client, ledger):
    """AC12: clearing from 2026-09 leaves August as it was and unbudgets September on."""
    _seed(ledger)  # groceries 1000 from 07 and 1200 from 09, metro 200 from 07
    ledger.set_budgets("2026-09", {ledger.groceries: None})

    august = client.get(f"{API}/summary/months/2026-08").json()
    assert august["budget"] == "1200.00"
    assert _budgets(august) == {
        ledger.food: "1000.00",
        ledger.groceries: "1000.00",
        ledger.dining: None,
        ledger.transport: "200.00",
        ledger.metro: "200.00",
    }
    for month in ("2026-09", "2026-10"):
        detail = client.get(f"{API}/summary/months/{month}").json()
        assert detail["budget"] == "200.00"
        assert _budgets(detail) == {
            ledger.food: None,  # every child is unbudgeted
            ledger.groceries: None,
            ledger.dining: None,
            ledger.transport: "200.00",
            ledger.metro: "200.00",
        }
    # Actuals do not depend on the budget.
    september = client.get(f"{API}/summary/months/2026-09").json()
    assert september["actual"] == "828.80"
    assert september["categories"][0]["children"][0]["actual"] == "480.00"

    monthly = client.get(f"{API}/summary/monthly", params={"from": "2026-07", "to": "2026-11"})
    assert monthly.json()["months"] == [
        {"month": "2026-07", "budget": "1200.00", "actual": "300.00", "annual_actual": "0.00"},
        {"month": "2026-08", "budget": "1200.00", "actual": "410.10", "annual_actual": "0.00"},
        {"month": "2026-09", "budget": "200.00", "actual": "828.80", "annual_actual": "0.00"},
        {"month": "2026-10", "budget": "200.00", "actual": "0.00", "annual_actual": "0.00"},
        {"month": "2026-11", "budget": "200.00", "actual": "0.00", "annual_actual": "0.00"},
    ]

    # Clearing the last budgeted category leaves the whole month without a budget ...
    ledger.set_budgets("2026-10", {ledger.metro: None})
    # ... and setting an amount again restores one from that month.
    ledger.set_budgets("2026-11", {ledger.groceries: "900"})
    monthly = client.get(f"{API}/summary/monthly", params={"from": "2026-09", "to": "2026-11"})
    assert [(m["month"], m["budget"]) for m in monthly.json()["months"]] == [
        ("2026-09", "200.00"),
        ("2026-10", None),
        ("2026-11", "900.00"),
    ]
    october = client.get(f"{API}/summary/months/2026-10").json()
    assert october["budget"] is None
    assert set(_budgets(october).values()) == {None}
    november = client.get(f"{API}/summary/months/2026-11").json()
    assert (november["budget"], _budgets(november)[ledger.food]) == ("900.00", "900.00")


def test_level1_budget_sums_budgeted_zero_and_cleared_children(client, ledger):
    """A level-1 budget is the sum of its children that have a budget: zero counts as
    one, cleared and never-set do not; with no budgeted child it is null, not 0."""
    snacks = ledger.category("零食", ledger.food)
    bus = ledger.category("公交", ledger.transport)
    ledger.set_budgets(
        "2026-01",
        {ledger.groceries: "1000", ledger.dining: "300", snacks: "50", ledger.metro: "200"},
    )
    # From March: one budgeted, one zero and one cleared child under 餐饮; a cleared and a
    # never-set child under 交通.
    ledger.set_budgets("2026-03", {ledger.dining: "0", snacks: None, ledger.metro: None})

    february = client.get(f"{API}/summary/months/2026-02").json()
    assert february["budget"] == "1550.00"
    assert _budgets(february) == {
        ledger.food: "1350.00",
        ledger.groceries: "1000.00",
        ledger.dining: "300.00",
        snacks: "50.00",
        ledger.transport: "200.00",
        ledger.metro: "200.00",
        bus: None,
    }
    march = client.get(f"{API}/summary/months/2026-03").json()
    assert march["budget"] == "1000.00"
    assert _budgets(march) == {
        ledger.food: "1000.00",
        ledger.groceries: "1000.00",
        ledger.dining: "0.00",
        snacks: None,
        ledger.transport: None,
        ledger.metro: None,
        bus: None,
    }

    # Zero and cleared only: the level-1 budget is a real 0, not "no budget".
    ledger.set_budgets("2026-05", {ledger.groceries: None})
    may = client.get(f"{API}/summary/months/2026-05").json()
    assert may["budget"] == "0.00"
    assert _budgets(may)[ledger.food] == "0.00"
    assert _budgets(may)[ledger.transport] is None

    monthly = client.get(f"{API}/summary/monthly", params={"from": "2026-02", "to": "2026-05"})
    assert [(m["month"], m["budget"]) for m in monthly.json()["months"]] == [
        ("2026-02", "1550.00"),
        ("2026-03", "1000.00"),
        ("2026-04", "1000.00"),
        ("2026-05", "0.00"),
    ]


def test_monthly_series_defaults_to_twelve_months(client, ledger):
    months = client.get(f"{API}/summary/monthly").json()["months"]
    this_month = date.today().replace(day=1)
    assert len(months) == 12
    assert months[-1]["month"] == format_month(this_month)
    assert months[0]["month"] == format_month(add_months(this_month, -11))

    ending = client.get(f"{API}/summary/monthly", params={"to": "2026-01"}).json()["months"]
    assert [m["month"] for m in ending][::11] == ["2025-02", "2026-01"]


def test_summary_validation(client, ledger):
    url = f"{API}/summary/monthly"
    reversed_range = client.get(url, params={"from": "2026-10", "to": "2026-09"})
    assert_envelope(reversed_range, 422, "INVALID_MONTH_RANGE")
    too_long = client.get(url, params={"from": "2000-01", "to": "2026-09"})
    assert_envelope(too_long, 422, "INVALID_MONTH_RANGE")
    assert_envelope(client.get(url, params={"from": "2026/09"}), 422, "VALIDATION_ERROR")
    assert_envelope(client.get(f"{API}/summary/months/2026-9"), 422, "VALIDATION_ERROR")
    # The ends of the calendar are a rejected month, not a crash in month arithmetic.
    for path in (
        "summary/months/9999-12",
        "summary/monthly?to=9999-12",
        "summary/monthly?to=0001-01",
        "transactions?month=9999-12",
    ):
        assert_envelope(client.get(f"{API}/{path}"), 422, "INVALID_MONTH")
    unknown = {"budget_account_id": 999}
    for path in ("summary/monthly", "summary/months/2026-09"):
        response = client.get(f"{API}/{path}", params=unknown)
        assert_envelope(response, 422, "BUDGET_ACCOUNT_NOT_FOUND")


def _housing(ledger: Ledger) -> tuple[int, int, int, int]:
    """居住 with 房租 in a "固定" budget account and 维修 in "日常". 房租 is paid from the
    savings card, 维修 from a credit card. Returns (固定, 居住, 房租, 维修)."""
    fixed = ledger.budget_account("固定")
    housing = ledger.category("居住")
    rent = ledger.category("房租", housing, fixed)
    repair = ledger.category("维修", housing, ledger.daily)
    card = ledger.add_channel("信用卡")
    ledger.set_budgets("2026-09", {rent: "6500", repair: "500"})
    rent_paid = ledger.item(amount="6500", counterparty="自如寓", category_id=rent)
    assert ledger.submit([rent_paid]).status_code == 201
    repair_paid = ledger.item(amount="300", counterparty="维修师傅", category_id=repair)
    assert ledger.submit([repair_paid], channel_id=card).status_code == 201
    return fixed, housing, rent, repair


def _rows(detail: dict) -> dict[str, tuple[str | None, str, list[str]]]:
    """Level-1 name -> (budget, actual, level-2 names) of a month detail."""
    return {
        row["name"]: (row["budget"], row["actual"], [child["name"] for child in row["children"]])
        for row in detail["categories"]
    }


def test_spending_counts_in_the_budget_account_of_its_category(client, ledger):
    """Acceptance (R5, D3, D9): rent paid through the savings card counts in "固定"; it
    does not appear under "日常"; "全部" shows 居住 = 房租 + 维修. Channels play no part."""
    fixed, _, _, _ = _housing(ledger)
    url = f"{API}/summary/months/2026-09"

    fixed_view = client.get(url, params={"budget_account_id": fixed}).json()
    assert fixed_view["budget_account_id"] == fixed
    assert (fixed_view["budget"], fixed_view["actual"]) == ("6500.00", "6500.00")
    assert _rows(fixed_view) == {"居住": ("6500.00", "6500.00", ["房租"])}

    daily_view = client.get(url, params={"budget_account_id": ledger.daily}).json()
    assert _rows(daily_view) == {
        "餐饮": (None, "0.00", ["买菜", "外食"]),
        "交通": (None, "0.00", ["地铁"]),
        "居住": ("500.00", "300.00", ["维修"]),
    }
    assert (daily_view["budget"], daily_view["actual"]) == ("500.00", "300.00")

    everything = client.get(url).json()
    assert everything["budget_account_id"] is None
    assert _rows(everything)["居住"] == ("7000.00", "6800.00", ["房租", "维修"])
    assert (everything["budget"], everything["actual"]) == ("7000.00", "6800.00")

    def monthly(params: dict) -> list[dict]:
        query = {"from": "2026-09", "to": "2026-09", **params}
        return client.get(f"{API}/summary/monthly", params=query).json()["months"]

    assert monthly({"budget_account_id": fixed}) == [
        {"month": "2026-09", "budget": "6500.00", "actual": "6500.00", "annual_actual": "0.00"}
    ]
    assert monthly({"budget_account_id": ledger.daily}) == [
        {"month": "2026-09", "budget": "500.00", "actual": "300.00", "annual_actual": "0.00"}
    ]
    assert monthly({}) == [
        {"month": "2026-09", "budget": "7000.00", "actual": "6800.00", "annual_actual": "0.00"}
    ]


def test_moving_a_category_to_another_budget_account_moves_its_history(client, ledger):
    """Acceptance (D4): after 维修 moves to "固定", past months of "固定" include it."""
    fixed, _, _, repair = _housing(ledger)
    moved = client.patch(f"{API}/categories/{repair}", json={"budget_account_id": fixed})
    assert moved.status_code == 200

    url = f"{API}/summary/months/2026-09"
    fixed_view = client.get(url, params={"budget_account_id": fixed}).json()
    assert _rows(fixed_view) == {"居住": ("7000.00", "6800.00", ["房租", "维修"])}
    daily_view = client.get(url, params={"budget_account_id": ledger.daily}).json()
    assert "居住" not in _rows(daily_view)
    assert daily_view["actual"] == "0.00"
    monthly = client.get(
        f"{API}/summary/monthly",
        params={"from": "2026-09", "to": "2026-09", "budget_account_id": fixed},
    )
    assert monthly.json()["months"] == [
        {"month": "2026-09", "budget": "7000.00", "actual": "6800.00", "annual_actual": "0.00"}
    ]
    # The transactions themselves report the new budget account.
    listed = client.get(f"{API}/transactions", params={"budget_account_id": fixed}).json()
    assert {t["budget_account_name"] for t in listed["items"]} == {"固定"}
    assert listed["total"] == 2


def _annual(ledger: Ledger) -> tuple[int, int, int, int]:
    """An annual budget account "年度": 保险 under 年度开支 (only annual children) and 旅行
    under 交通 (next to the monthly 地铁). 2026 budgets 20000 + 10000; 6000 paid in
    January, 2000 in March. Returns (年度, 年度开支, 保险, 旅行)."""
    yearly = ledger.budget_account("年度", "year")
    annual_group = ledger.category("年度开支")
    insurance = ledger.category("保险", annual_group, yearly)
    travel = ledger.category("旅行", ledger.transport, yearly)
    ledger.set_budgets("2026-05", {insurance: "20000", travel: "10000"})
    paid = [
        ledger.item(
            date="2026-01-20", amount="6000", counterparty="保险公司", category_id=insurance
        ),
        ledger.item(date="2026-03-02", amount="2000", counterparty="航空公司", category_id=travel),
    ]
    assert ledger.submit(paid).status_code == 201
    return yearly, annual_group, insurance, travel


def test_annual_account_year_to_date(client, ledger):
    """AC5 (R4): through 2026-03 the annual account shows 8000 of 30000, per month and per
    category; spending past the budget shows as actual > budget."""
    yearly, annual_group, insurance, travel = _annual(ledger)
    url = f"{API}/summary/annual/2026-03"
    body = client.get(url, params={"budget_account_id": yearly}).json()
    assert body == {
        "currency": "CNY",
        "year": 2026,
        "through": "2026-03",
        "accounts": [
            {
                "budget_account_id": yearly,
                "name": "年度",
                "budget": "30000.00",
                "actual": "8000.00",
                "count": 2,
                "months": [
                    {"month": "2026-01", "actual": "6000.00"},
                    {"month": "2026-02", "actual": "0.00"},
                    {"month": "2026-03", "actual": "2000.00"},
                ],
                "categories": [
                    {
                        "category_id": ledger.transport,
                        "name": "交通",
                        "budget": "10000.00",
                        "actual": "2000.00",
                        "count": 1,
                        "children": [
                            {
                                "category_id": travel,
                                "name": "旅行",
                                "budget": "10000.00",
                                "actual": "2000.00",
                                "count": 1,
                            }
                        ],
                    },
                    {
                        "category_id": annual_group,
                        "name": "年度开支",
                        "budget": "20000.00",
                        "actual": "6000.00",
                        "count": 1,
                        "children": [
                            {
                                "category_id": insurance,
                                "name": "保险",
                                "budget": "20000.00",
                                "actual": "6000.00",
                                "count": 1,
                            }
                        ],
                    },
                ],
            }
        ],
    }
    # Without an account: every annual account (the same one here).
    assert client.get(url).json() == body
    # Through January only January counts; a later month of another year starts over.
    january = client.get(f"{API}/summary/annual/2026-01").json()["accounts"][0]
    assert (january["budget"], january["actual"], len(january["months"])) == (
        "30000.00",
        "6000.00",
        1,
    )
    next_year = client.get(f"{API}/summary/annual/2027-02").json()["accounts"][0]
    assert next_year["actual"] == "0.00"
    assert next_year["budget"] == "30000.00"  # carried forward until 2027 gets its version

    more = ledger.item(
        date="2026-03-20", amount="23000", counterparty="理赔", category_id=insurance
    )
    assert ledger.submit([more]).status_code == 201
    over = client.get(url, params={"budget_account_id": yearly}).json()["accounts"][0]
    assert (over["budget"], over["actual"]) == ("30000.00", "31000.00")

    # A monthly account has no annual summary; unknown ids are refused as usual.
    monthly = client.get(url, params={"budget_account_id": ledger.daily})
    assert_envelope(monthly, 422, "NOT_ANNUAL_ACCOUNT")
    unknown = client.get(url, params={"budget_account_id": 999})
    assert_envelope(unknown, 422, "BUDGET_ACCOUNT_NOT_FOUND")
    assert_envelope(client.get(f"{API}/summary/annual/2026-13"), 422, "VALIDATION_ERROR")


def test_annual_summary_without_annual_accounts_is_empty(client, ledger):
    body = client.get(f"{API}/summary/annual/2026-09").json()
    assert body == {"currency": "CNY", "year": 2026, "through": "2026-09", "accounts": []}


def test_all_scope_keeps_annual_spending_out_of_the_monthly_comparison(client, ledger):
    """AC6 (R5): in a month with 5000 monthly and 6000 annual spending, "全部" compares
    5000 with the monthly budgets and reports the 6000 apart; the tree has no annual
    categories and drops a level-1 category whose children are all annual."""
    yearly, annual_group, insurance, travel = _annual(ledger)
    ledger.set_budgets("2026-01", {ledger.groceries: "4000", ledger.metro: "300"})
    paid = [
        ledger.item(date="2026-01-05", amount="4800", counterparty="超市"),
        ledger.item(date="2026-01-06", amount="200", counterparty="地铁", category_id=ledger.metro),
    ]
    assert ledger.submit(paid).status_code == 201
    empty = ledger.category("居家")  # level 1 without children stays

    detail = client.get(f"{API}/summary/months/2026-01").json()
    assert (detail["budget"], detail["actual"], detail["annual_actual"]) == (
        "4300.00",
        "5000.00",
        "6000.00",
    )
    assert _rows(detail) == {
        "餐饮": ("4000.00", "4800.00", ["买菜", "外食"]),
        "交通": ("300.00", "200.00", ["地铁"]),
        "居家": (None, "0.00", []),
    }
    assert empty in [row["category_id"] for row in detail["categories"]]

    monthly = client.get(f"{API}/summary/monthly", params={"from": "2026-01", "to": "2026-03"})
    assert monthly.json()["months"] == [
        {"month": "2026-01", "budget": "4300.00", "actual": "5000.00", "annual_actual": "6000.00"},
        {"month": "2026-02", "budget": "4300.00", "actual": "0.00", "annual_actual": "0.00"},
        {"month": "2026-03", "budget": "4300.00", "actual": "0.00", "annual_actual": "2000.00"},
    ]

    # A single monthly account is unchanged; a single annual one has nothing monthly.
    daily = client.get(
        f"{API}/summary/months/2026-01", params={"budget_account_id": ledger.daily}
    ).json()
    assert (daily["budget"], daily["actual"], daily["annual_actual"]) == (
        "4300.00",
        "5000.00",
        "0.00",
    )
    assert _rows(daily) == {
        "餐饮": ("4000.00", "4800.00", ["买菜", "外食"]),
        "交通": ("300.00", "200.00", ["地铁"]),
    }
    annual_month = client.get(
        f"{API}/summary/months/2026-01", params={"budget_account_id": yearly}
    ).json()
    assert (annual_month["budget"], annual_month["actual"], annual_month["annual_actual"]) == (
        None,
        "0.00",
        "6000.00",
    )
    assert annual_month["categories"] == []
    annual_series = client.get(
        f"{API}/summary/monthly",
        params={"from": "2026-01", "to": "2026-01", "budget_account_id": yearly},
    )
    assert annual_series.json()["months"] == [
        {"month": "2026-01", "budget": None, "actual": "0.00", "annual_actual": "6000.00"}
    ]


def test_summaries_follow_the_category_order(client, ledger):
    """AC4: the month detail and the annual summary list categories in the order set by
    the user, level-2 rows under their own level-1 row."""
    _seed(ledger)
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险")
    car = ledger.category("车险", insurance, yearly)
    medical = ledger.category("医疗险", insurance, yearly)
    travel = ledger.category("机票", ledger.transport, yearly)
    order = f"{API}/categories/order"
    for parent_id, ordered_ids in [
        (None, [insurance, ledger.transport, ledger.food]),
        (ledger.food, [ledger.dining, ledger.groceries]),
        (insurance, [medical, car]),
        (ledger.transport, [travel, ledger.metro]),
    ]:
        reordered = client.put(order, json={"parent_id": parent_id, "ordered_ids": ordered_ids})
        assert reordered.status_code == 200, reordered.text

    def rows(body: dict) -> list[tuple[str, list[str]]]:
        return [(r["name"], [c["name"] for c in r["children"]]) for r in body["categories"]]

    detail = client.get(f"{API}/summary/months/2026-09").json()
    assert rows(detail) == [("交通", ["地铁"]), ("餐饮", ["外食", "买菜"])]
    assert (detail["budget"], detail["actual"]) == ("1400.00", "828.80")  # totals unchanged

    annual = client.get(f"{API}/summary/annual/2026-09").json()
    assert [rows(account) for account in annual["accounts"]] == [
        [("保险", ["医疗险", "车险"]), ("交通", ["机票"])]
    ]
