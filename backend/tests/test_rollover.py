"""Rollover categories and the budgets page's reference values (task
10-23-actual-inspired, R3, R5)."""

from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope


def detail_row(client, month: str, category_id: int) -> dict:
    body = client.get(f"{API}/summary/months/{month}").json()
    return next(
        child
        for row in body["categories"]
        for child in row["children"]
        if child["category_id"] == category_id
    )


def budget_line(client, month: str, category_id: int) -> dict:
    body = client.get(f"{API}/budgets", params={"month": month}).json()
    return next(line for line in body["budgets"] if line["category_id"] == category_id)


def spend(ledger: Ledger, day: str, amount: str, category_id: int, who: str = "店") -> None:
    item = ledger.item(date=day, amount=amount, counterparty=who, category_id=category_id)
    response = ledger.submit([item])
    assert response.status_code == 201, response.text


def test_rollover_carries_what_is_left_and_what_is_overspent(client, ledger):
    """AC10: from August, 500 a month, 300 then 600 spent: October starts with +100; 550
    spent of 600 leaves 50. The month totals ignore carry-ins."""
    ledger.set_budgets("2026-07", {ledger.dining: "500"})
    spend(ledger, "2026-07-10", "50", ledger.dining, "七月")  # before rollover: ignored
    spend(ledger, "2026-08-10", "300", ledger.dining, "八月")
    spend(ledger, "2026-09-10", "600", ledger.dining, "九月")
    spend(ledger, "2026-10-10", "550", ledger.dining, "十月")

    on = client.patch(f"{API}/categories/{ledger.dining}", json={"rollover_from": "2026-08"})
    assert on.status_code == 200, on.text
    assert on.json()["rollover_from"] == "2026-08"

    assert detail_row(client, "2026-07", ledger.dining)["carry_in"] is None
    assert detail_row(client, "2026-08", ledger.dining)["carry_in"] == "0.00"
    assert detail_row(client, "2026-09", ledger.dining)["carry_in"] == "200.00"
    october = client.get(f"{API}/summary/months/2026-10").json()
    row = detail_row(client, "2026-10", ledger.dining)
    assert (row["carry_in"], row["budget"], row["actual"]) == ("100.00", "500.00", "550.00")
    assert october["rollover_available"] == "50.00"
    assert october["budget"] == "500.00"  # the month total has no carry-in
    assert detail_row(client, "2026-10", ledger.groceries)["carry_in"] is None
    assert budget_line(client, "2026-10", ledger.dining)["carry_in"] == "100.00"

    # A month without a budget counts as 0: November inherits October's 50 and spends it.
    ledger.set_budgets("2026-11", {ledger.dining: None})
    spend(ledger, "2026-11-03", "80", ledger.dining, "十一月")
    assert detail_row(client, "2026-11", ledger.dining)["carry_in"] == "50.00"
    assert client.get(f"{API}/summary/months/2026-11").json()["rollover_available"] == "-30.00"

    off = client.patch(f"{API}/categories/{ledger.dining}", json={"rollover_from": None})
    assert off.json()["rollover_from"] is None
    assert detail_row(client, "2026-10", ledger.dining)["carry_in"] is None
    assert client.get(f"{API}/summary/months/2026-10").json()["rollover_available"] is None


def test_rollover_is_for_level2_categories_of_monthly_accounts(client, ledger):
    assert_envelope(
        client.patch(f"{API}/categories/{ledger.food}", json={"rollover_from": "2026-10"}),
        422,
        "ROLLOVER_LEVEL2_ONLY",
    )
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    assert_envelope(
        client.patch(f"{API}/categories/{insurance}", json={"rollover_from": "2026-10"}),
        422,
        "ROLLOVER_NOT_MONTHLY",
    )
    client.patch(f"{API}/categories/{ledger.dining}", json={"rollover_from": "2026-10"})
    moved = client.patch(
        f"{API}/categories/{ledger.dining}",
        json={"budget_account_id": yearly, "budget_amount": None},
    )
    assert moved.status_code == 200, moved.text
    assert moved.json()["rollover_from"] is None


def test_budget_lines_carry_last_month_and_the_three_month_average(client, ledger):
    """AC5: references match the summaries' actuals (refunds included)."""
    spend(ledger, "2026-07-05", "90", ledger.groceries, "a")
    spend(ledger, "2026-08-05", "100", ledger.groceries, "b")
    spend(ledger, "2026-09-05", "120", ledger.groceries, "c")
    spend(ledger, "2026-09-06", "-20", ledger.groceries, "d")
    spend(ledger, "2026-10-05", "999", ledger.groceries, "e")  # the month itself: not used

    line = budget_line(client, "2026-10", ledger.groceries)
    assert line["reference_last"] == detail_row(client, "2026-09", ledger.groceries)["actual"]
    assert (line["reference_last"], line["reference_avg3"]) == ("100.00", "96.67")
    assert budget_line(client, "2026-10", ledger.metro)["reference_avg3"] == "0.00"

    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    spend(ledger, "2025-03-01", "6000", insurance, "保险公司")
    annual = budget_line(client, "2026-10", insurance)
    assert (annual["reference_last"], annual["reference_avg3"]) == ("6000.00", None)
