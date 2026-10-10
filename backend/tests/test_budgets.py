"""AC6 (get_budgets per level-2 category for a month) and AC12 (effective-from, clearing)."""

from datetime import date

from sqlalchemy import text

from app.db import get_engine
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
    # Clearing is an explicit null; leaving the amount out is not a way to clear.
    assert_envelope(put("2026-01", [{"category_id": ledger.metro}]), 422, "VALIDATION_ERROR")
    cleared_level1 = put("2026-01", [{"category_id": ledger.food, "amount": None}])
    assert_envelope(cleared_level1, 422, "CATEGORY_NOT_LEAF")
    # One bad item means nothing from the request is stored.
    mixed = put(
        "2026-01",
        [{"category_id": ledger.metro, "amount": "1"}, {"category_id": ledger.food, "amount": "2"}],
    )
    assert_envelope(mixed, 422, "CATEGORY_NOT_LEAF")
    assert _amounts(client, ledger, "2026-01")[ledger.metro] is None

    assert_envelope(client.get(f"{ledger.base}/budgets?month=2026-1"), 422, "VALIDATION_ERROR")
    assert_envelope(client.get(f"{API}/accounts/999/budgets"), 404, "ACCOUNT_NOT_FOUND")


def _lines(http, ledger, month: str) -> dict[int, dict]:
    response = http.get(f"{ledger.base}/budgets", params={"month": month})
    assert response.status_code == 200, response.text
    return {line["category_id"]: line for line in response.json()["budgets"]}


def _stored(category_id: int) -> list[tuple[str, str | None]]:
    """The budget versions of a category as stored: (effective_from, amount)."""
    with get_engine().connect() as connection:
        rows = connection.execute(
            text(
                "SELECT to_char(effective_from, 'YYYY-MM'), amount::text FROM budgets"
                " WHERE category_id = :id ORDER BY effective_from"
            ),
            {"id": category_id},
        )
        return [tuple(row) for row in rows]


def test_clearing_a_budget_applies_from_the_chosen_month(client, agent, ledger):
    """AC12: cleared from month M means "no budget" for M and later; M-1 keeps its amount."""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000", ledger.metro: "200"})
    cleared = ledger.set_budgets("2026-06", {ledger.groceries: None})

    # The response is the budget view of the effective month, like any other PUT.
    assert cleared == client.get(f"{ledger.base}/budgets", params={"month": "2026-06"}).json()
    no_budget = {
        "category_id": ledger.groceries,
        "category_name": "买菜",
        "parent_id": ledger.food,
        "parent_name": "餐饮",
        "amount": None,
        "effective_from": None,
    }
    assert _lines(client, ledger, "2026-06")[ledger.groceries] == no_budget
    assert _lines(client, ledger, "2027-03")[ledger.groceries] == no_budget
    # A cleared budget reads exactly like one that was never set.
    assert _lines(client, ledger, "2025-12")[ledger.groceries] == no_budget
    before = _lines(client, ledger, "2026-05")[ledger.groceries]
    assert (before["amount"], before["effective_from"]) == ("1000.00", "2026-01")
    # Categories that were not in the request are untouched.
    assert _amounts(client, ledger, "2026-06")[ledger.metro] == "200.00"
    # An agent token reads the same thing.
    assert _lines(agent, ledger, "2026-06") == _lines(client, ledger, "2026-06")
    assert _lines(agent, ledger, "2026-05") == _lines(client, ledger, "2026-05")


def test_cleared_is_distinct_from_zero(client, ledger):
    ledger.set_budgets("2026-01", {ledger.groceries: "1000", ledger.metro: "200"})
    ledger.set_budgets("2026-06", {ledger.groceries: None, ledger.metro: "0"})

    lines = _lines(client, ledger, "2026-06")
    groceries, metro = lines[ledger.groceries], lines[ledger.metro]
    assert (groceries["amount"], groceries["effective_from"]) == (None, None)
    assert (metro["amount"], metro["effective_from"]) == ("0.00", "2026-06")
    assert _stored(ledger.groceries) == [("2026-01", "1000.00"), ("2026-06", None)]
    assert _stored(ledger.metro) == [("2026-01", "200.00"), ("2026-06", "0.00")]

    # Zero can be cleared, and a cleared month can be given a zero budget.
    ledger.set_budgets("2026-06", {ledger.groceries: "0", ledger.metro: None})
    assert _amounts(client, ledger, "2026-06") == {
        ledger.groceries: "0.00",
        ledger.dining: None,
        ledger.metro: None,
    }


def test_setting_again_after_clearing_restores_from_that_month(client, ledger):
    """AC12"""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000"})
    ledger.set_budgets("2026-04", {ledger.groceries: None})
    ledger.set_budgets("2026-08", {ledger.groceries: "700"})

    expected = {
        "2025-12": None,
        "2026-01": "1000.00",
        "2026-03": "1000.00",
        "2026-04": None,
        "2026-07": None,
        "2026-08": "700.00",
        "2027-01": "700.00",
    }
    assert {m: _amounts(client, ledger, m)[ledger.groceries] for m in expected} == expected
    assert _lines(client, ledger, "2026-09")[ledger.groceries]["effective_from"] == "2026-08"

    # Setting an amount for the very month that was cleared replaces the clearing.
    ledger.set_budgets("2026-04", {ledger.groceries: "900"})
    assert _amounts(client, ledger, "2026-03")[ledger.groceries] == "1000.00"
    assert _amounts(client, ledger, "2026-07")[ledger.groceries] == "900.00"
    assert _amounts(client, ledger, "2026-08")[ledger.groceries] == "700.00"


def test_clearing_where_there_is_no_budget_is_accepted_and_stores_nothing(client, ledger):
    # Never budgeted.
    ledger.set_budgets("2026-03", {ledger.dining: None})
    assert _stored(ledger.dining) == []
    assert _amounts(client, ledger, "2026-03")[ledger.dining] is None
    # So a budget set later from an earlier month is not cut short by an invisible version.
    ledger.set_budgets("2026-01", {ledger.dining: "300"})
    assert _amounts(client, ledger, "2026-05")[ledger.dining] == "300.00"

    # Before the first version: nothing to clear, later months keep their budget.
    ledger.set_budgets("2025-06", {ledger.dining: None})
    assert _stored(ledger.dining) == [("2026-01", "300.00")]

    # Already cleared: clearing again later adds no version.
    ledger.set_budgets("2026-04", {ledger.dining: None})
    ledger.set_budgets("2026-09", {ledger.dining: None})
    assert _stored(ledger.dining) == [("2026-01", "300.00"), ("2026-04", None)]

    # Clearing the month of the only version leaves no version behind.
    ledger.set_budgets("2026-02", {ledger.metro: "50"})
    ledger.set_budgets("2026-02", {ledger.metro: None})
    assert _stored(ledger.metro) == []
    assert _amounts(client, ledger, "2026-12")[ledger.metro] is None


def test_clear_left_without_a_budget_before_it_is_removed(client, ledger):
    """R6: set from Jan, cleared from Apr, then cleared from Jan; a later set from Feb
    is not cut short at Apr by the stale clear."""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000"})
    ledger.set_budgets("2026-04", {ledger.groceries: None})
    ledger.set_budgets("2026-01", {ledger.groceries: None})
    assert _stored(ledger.groceries) == []

    ledger.set_budgets("2026-02", {ledger.groceries: "800"})
    assert _stored(ledger.groceries) == [("2026-02", "800.00")]
    expected = {
        "2026-01": None,
        "2026-02": "800.00",
        "2026-04": "800.00",
        "2027-06": "800.00",
    }
    assert {m: _amounts(client, ledger, m)[ledger.groceries] for m in expected} == expected


def test_consecutive_clears_collapse_and_a_clear_after_a_budget_is_kept(client, ledger):
    """R6"""
    ledger.set_budgets("2026-01", {ledger.dining: "300"})
    ledger.set_budgets("2026-03", {ledger.dining: "400"})
    ledger.set_budgets("2026-05", {ledger.dining: None})
    # A clear after a real budget is kept.
    assert _stored(ledger.dining) == [
        ("2026-01", "300.00"),
        ("2026-03", "400.00"),
        ("2026-05", None),
    ]

    # Clearing from Mar makes the May clear follow another clear: it collapses into Mar.
    ledger.set_budgets("2026-03", {ledger.dining: None})
    assert _stored(ledger.dining) == [("2026-01", "300.00"), ("2026-03", None)]
    assert _amounts(client, ledger, "2026-02")[ledger.dining] == "300.00"
    assert _amounts(client, ledger, "2026-03")[ledger.dining] is None
    assert _amounts(client, ledger, "2026-06")[ledger.dining] is None

    # Only the categories in the request are normalised; others keep their history.
    ledger.set_budgets("2026-01", {ledger.metro: "50"})
    ledger.set_budgets("2026-06", {ledger.metro: None})
    ledger.set_budgets("2026-01", {ledger.dining: None})
    assert _stored(ledger.dining) == []
    assert _stored(ledger.metro) == [("2026-01", "50.00"), ("2026-06", None)]


def test_one_request_normalises_each_category_on_its_own_history(client, ledger):
    """R6: several categories in one PUT; each keeps or loses its clears by its own walk."""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000", ledger.dining: "300"})
    ledger.set_budgets("2026-04", {ledger.groceries: None, ledger.dining: None})
    ledger.set_budgets("2026-02", {ledger.metro: "50"})
    ledger.set_budgets("2026-05", {ledger.metro: None})

    # Groceries loses its Jan budget (so its Apr clear goes too); dining only changes its
    # Jan amount, so its Apr clear still ends a budget and stays.
    ledger.set_budgets("2026-01", {ledger.groceries: None, ledger.dining: "350"})
    assert _stored(ledger.groceries) == []
    assert _stored(ledger.dining) == [("2026-01", "350.00"), ("2026-04", None)]
    assert _stored(ledger.metro) == [("2026-02", "50.00"), ("2026-05", None)]
    assert _amounts(client, ledger, "2026-04")[ledger.dining] is None


def test_agent_token_cannot_clear_a_budget(client, agent, ledger):
    """AC7/AC12: clearing is a budget edit, so it needs the user's session."""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000"})
    items = [{"category_id": ledger.groceries, "amount": None}]
    refused = agent.put(
        f"{ledger.base}/budgets", json={"effective_from": "2026-01", "items": items}
    )
    assert_envelope(refused, 403, "TOKEN_SCOPE_FORBIDDEN")
    assert _amounts(client, ledger, "2026-01")[ledger.groceries] == "1000.00"
