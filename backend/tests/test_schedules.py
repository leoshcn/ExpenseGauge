"""Scheduled expenses (task 10-23-actual-inspired, R6): CRUD, due dates, matching
payments, overdue vs pending, the month's forecast and suggestions from history."""

from datetime import date

import pytest

from app.services import schedules as schedule_service
from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope

URL = f"{API}/schedules"


@pytest.fixture
def today(monkeypatch):
    """Sets "today" for the schedules service."""

    def set_today(value: str) -> None:
        monkeypatch.setattr(schedule_service, "_today", lambda: date.fromisoformat(value))

    set_today("2026-10-23")
    return set_today


def create(client, ledger: Ledger, **fields) -> dict:
    body = {
        "name": "房租",
        "keyword": "自如",
        "category_id": ledger.groceries,
        "amount": "6500",
        "day": 1,
        "start_month": "2026-01",
        **fields,
    }
    response = client.post(URL, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def pay(ledger: Ledger, day: str, amount: str, who: str = "自如", category_id=None) -> int:
    item = ledger.item(
        date=day,
        amount=amount,
        counterparty=who,
        description="月租",
        category_id=category_id or ledger.groceries,
    )
    response = ledger.submit([item])
    assert response.status_code == 201, response.text
    return response.json()["transactions"][0]["id"]


def status(client, month: str, **params) -> dict:
    response = client.get(f"{URL}/status", params={"month": month, **params})
    assert response.status_code == 200, response.text
    return response.json()


def test_rent_is_paid_then_overdue_when_its_payment_is_gone(client, ledger, today):
    """AC11: 6500 on the 1st, keyword 自如: paid with the payment, overdue without it after
    the 4th; the forecast adds what has not arrived."""
    rent = create(client, ledger)
    paid_id = pay(ledger, "2026-10-01", "6500.00")

    body = status(client, "2026-10")
    [item] = body["items"]
    assert (item["status"], item["due_date"], item["transaction"]["id"]) == (
        "paid",
        "2026-10-01",
        paid_id,
    )
    assert body["forecast"] == {"actual": "6500.00", "outstanding": "0.00", "projected": "6500.00"}

    client.delete(f"{API}/transactions/{paid_id}")
    today("2026-10-04")
    assert status(client, "2026-10")["items"][0]["status"] == "pending"
    today("2026-10-05")
    body = status(client, "2026-10")
    assert body["items"][0]["status"] == "overdue"
    assert body["forecast"] == {"actual": "0.00", "outstanding": "6500.00", "projected": "6500.00"}
    # Another month has no forecast; before the start month nothing is due.
    assert status(client, "2026-09")["forecast"] is None
    assert status(client, "2025-12")["items"] == []
    assert client.get(URL).json()[0]["id"] == rent["id"]


def test_matching_rules(client, ledger, today):
    """±3 days, ±7.5% only when approximate, keyword in counterparty or description,
    and one payment pays one schedule."""
    exact = create(client, ledger, name="宽带", keyword="电信", amount="99", day=10)
    approx = create(
        client, ledger, name="电费", keyword="电力", amount="200", day=-1, approximate=True
    )
    twin = create(client, ledger, name="宽带2", keyword="电信", amount="99", day=12)
    pay(ledger, "2026-09-13", "99.00", "中国电信")  # 3 days after the 10th
    pay(ledger, "2026-09-10", "99.01", "中国电信")  # not exact
    pay(ledger, "2026-09-27", "214.00", "国网电力")  # 7% over, 3 days before the 30th
    items = {item["schedule"]["id"]: item for item in status(client, "2026-09")["items"]}
    assert items[exact["id"]]["status"] == "paid"
    assert items[approx["id"]]["status"] == "paid"
    assert items[approx["id"]]["due_date"] == "2026-09-30"
    # The only exact 99.00 went to the first schedule; the twin finds nothing else.
    assert items[twin["id"]]["status"] == "overdue"

    pay(ledger, "2026-08-25", "99.00", "其他", category_id=None)
    assert status(client, "2026-08")["items"][0]["status"] == "overdue"


def test_due_days_clamp_and_yearly_schedules(client, ledger, today):
    monthly = create(client, ledger, name="月末", keyword="x", amount="10", day=31)
    yearly = create(
        client,
        ledger,
        name="保险",
        keyword="保险",
        amount="3000",
        day=15,
        frequency="year",
        month_of_year=2,
    )
    february = {
        item["schedule"]["id"]: item["due_date"] for item in status(client, "2026-02")["items"]
    }
    assert february == {monthly["id"]: "2026-02-28", yearly["id"]: "2026-02-15"}
    assert [i["schedule"]["id"] for i in status(client, "2026-03")["items"]] == [monthly["id"]]

    paused = client.patch(f"{URL}/{monthly['id']}", json={"active": False})
    assert paused.json()["active"] is False
    assert status(client, "2026-03")["items"] == []

    assert_envelope(
        client.post(URL, json={**yearly, "frequency": "year", "month_of_year": None, "id": None}),
        422,
        "VALIDATION_ERROR",
    )
    bad = {
        "name": "x",
        "keyword": "x",
        "category_id": ledger.groceries,
        "amount": "1",
        "day": 1,
        "frequency": "year",
    }
    assert_envelope(client.post(URL, json=bad), 422, "INVALID_SCHEDULE")
    assert_envelope(
        client.post(URL, json={**bad, "frequency": "month", "category_id": ledger.food}),
        422,
        "CATEGORY_NOT_LEAF",
    )
    to_monthly = client.patch(f"{URL}/{yearly['id']}", json={"frequency": "month"})
    assert to_monthly.json()["month_of_year"] is None


def test_scope_and_forecast_count_monthly_accounts_only(client, ledger, today):
    yearly_account = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly_account)
    create(client, ledger)
    create(
        client, ledger, name="保险", keyword="保险", amount="3000", day=20, category_id=insurance
    )
    body = status(client, "2026-10")
    assert len(body["items"]) == 2
    assert body["forecast"]["outstanding"] == "6500.00"
    scoped = status(client, "2026-10", budget_account_id=yearly_account)
    assert [i["schedule"]["name"] for i in scoped["items"]] == ["保险"]
    assert scoped["forecast"]["outstanding"] == "0.00"


def test_a_category_in_a_schedule_cannot_be_deleted(client, ledger, today):
    schedule = create(client, ledger, category_id=ledger.dining)
    assert_envelope(client.delete(f"{API}/categories/{ledger.dining}"), 409, "CATEGORY_IN_USE")
    assert client.delete(f"{URL}/{schedule['id']}").status_code == 204
    assert client.delete(f"{API}/categories/{ledger.dining}").status_code == 204


def test_suggestions_find_recurring_payments(client, ledger, today):
    """AC12: a monthly rent and a subscription are found; scattered spending is not; a
    created schedule's payments are no longer suggested."""
    for month in ("05", "06", "07", "08", "09", "10"):
        pay(ledger, f"2026-{month}-01", "6500.00", "自如")
    for month, day, amount in (("07", "09", "28.40"), ("08", "10", "29.10"), ("09", "08", "28.90")):
        pay(ledger, f"2026-{month}-{day}", amount, "GitHub")
    for month, day in (("07", "02"), ("08", "20"), ("09", "11")):
        pay(ledger, f"2026-{month}-{day}", "35.00", "盒马")  # days too far apart
    pay(ledger, "2026-03-01", "10.00", "旧的")  # before the window

    found = client.get(f"{URL}/suggestions").json()
    assert [(s["name"], s["amount"], s["day"], s["approximate"], s["months"]) for s in found] == [
        ("自如", "6500.00", 1, False, 6),
        ("GitHub", "28.90", 9, True, 3),
    ]
    create(client, ledger, keyword="自如")
    assert [s["name"] for s in client.get(f"{URL}/suggestions").json()] == ["GitHub"]
