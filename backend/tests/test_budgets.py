"""AC6 (get_budgets per level-2 category for a month) and AC12 (effective-from)."""

from datetime import date

from tests.test_auth import API, assert_envelope


def _amounts(http, ledger, month: str) -> dict[int, str | None]:
    response = http.get(f"{ledger.base}/budgets", params={"month": month})
    assert response.status_code == 200, response.text
    return {line["category_id"]: line["amount"] for line in response.json()["budgets"]}


def test_get_budgets_lists_every_level2_category(client, agent, ledger):
    """AC6"""
    ledger.set_budgets("2026-03", {ledger.groceries: "1500.00", ledger.metro: "0"})

    body = agent.get(f"{ledger.base}/budgets", params={"month": "2026-05"}).json()
    assert body == client.get(f"{ledger.base}/budgets", params={"month": "2026-05"}).json()
    assert body["account_id"] == ledger.account_id
    assert body["currency"] == "CNY"
    assert body["month"] == "2026-05"
    assert body["budgets"] == [
        {
            "category_id": ledger.groceries,
            "category_name": "买菜",
            "parent_id": ledger.food,
            "parent_name": "餐饮",
            "amount": "1500.00",
            "effective_from": "2026-03",
        },
        {
            "category_id": ledger.dining,
            "category_name": "外食",
            "parent_id": ledger.food,
            "parent_name": "餐饮",
            "amount": None,  # no budget
            "effective_from": None,
        },
        {
            "category_id": ledger.metro,
            "category_name": "地铁",
            "parent_id": ledger.transport,
            "parent_name": "交通",
            "amount": "0.00",  # zero is a real budget, not "no budget"
            "effective_from": "2026-03",
        },
    ]
    # Month defaults to the current month.
    default = client.get(f"{ledger.base}/budgets").json()
    assert default["month"] == date.today().strftime("%Y-%m")


def test_budget_effective_from_changes_later_months_only(client, ledger):
    """AC12"""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000"})
    ledger.set_budgets("2026-06", {ledger.groceries: "1200.50"})

    assert _amounts(client, ledger, "2025-12")[ledger.groceries] is None
    assert _amounts(client, ledger, "2026-01")[ledger.groceries] == "1000.00"
    assert _amounts(client, ledger, "2026-05")[ledger.groceries] == "1000.00"
    assert _amounts(client, ledger, "2026-06")[ledger.groceries] == "1200.50"
    assert _amounts(client, ledger, "2027-02")[ledger.groceries] == "1200.50"

    # A version inserted between two others only reaches up to the next one.
    ledger.set_budgets("2026-03", {ledger.groceries: "800"})
    assert _amounts(client, ledger, "2026-02")[ledger.groceries] == "1000.00"
    assert _amounts(client, ledger, "2026-04")[ledger.groceries] == "800.00"
    assert _amounts(client, ledger, "2026-06")[ledger.groceries] == "1200.50"

    # Setting the same month again replaces that version.
    replaced = ledger.set_budgets("2026-03", {ledger.groceries: "850"})
    assert replaced["month"] == "2026-03"
    assert _amounts(client, ledger, "2026-04")[ledger.groceries] == "850.00"


def test_budget_validation(client, ledger):
    def put(effective_from, items):
        return client.put(
            f"{ledger.base}/budgets", json={"effective_from": effective_from, "items": items}
        )

    # A level-1 budget cannot be entered directly.
    level1 = put("2026-01", [{"category_id": ledger.food, "amount": "10"}])
    assert_envelope(level1, 422, "CATEGORY_NOT_LEAF")
    unknown = put("2026-01", [{"category_id": 9999, "amount": "10"}])
    assert_envelope(unknown, 422, "CATEGORY_NOT_FOUND")
    negative = put("2026-01", [{"category_id": ledger.metro, "amount": "-1"}])
    assert_envelope(negative, 422, "VALIDATION_ERROR")
    bad_month = put("2026-13", [{"category_id": ledger.metro, "amount": "1"}])
    assert_envelope(bad_month, 422, "VALIDATION_ERROR")
    twice = put(
        "2026-01",
        [
            {"category_id": ledger.metro, "amount": "1"},
            {"category_id": ledger.metro, "amount": "2"},
        ],
    )
    assert_envelope(twice, 422, "DUPLICATE_CATEGORY")
    # One bad item means nothing from the request is stored.
    mixed = put(
        "2026-01",
        [{"category_id": ledger.metro, "amount": "1"}, {"category_id": ledger.food, "amount": "2"}],
    )
    assert_envelope(mixed, 422, "CATEGORY_NOT_LEAF")
    assert _amounts(client, ledger, "2026-01")[ledger.metro] is None

    assert_envelope(client.get(f"{ledger.base}/budgets?month=2026-1"), 422, "VALIDATION_ERROR")
    assert_envelope(client.get(f"{API}/accounts/999/budgets"), 404, "ACCOUNT_NOT_FOUND")
