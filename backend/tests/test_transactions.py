"""AC7-AC11 (batch submission and feedback) and the backend part of AC14 (edit, delete)."""

from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.services.transactions import compute_fingerprint, normalize_text
from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope


def _rejected(response) -> list[dict]:
    body = assert_envelope(response, 409, "BATCH_REJECTED")
    return body["details"]["items"]


def test_valid_batch_is_stored_in_full(client, agent, token, ledger):
    """AC7: stored in full, listed, and counted in the month's actuals."""
    items = [
        ledger.item(),
        ledger.item(counterparty="海底捞", amount=288, category_id=ledger.dining, note="生日"),
        ledger.item(
            counterparty="上海地铁", amount="4.00", category_id=ledger.metro, date="2026-09-16"
        ),
    ]
    response = ledger.submit(items, client=agent)
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["accepted"] is True
    assert [t["counterparty"] for t in body["transactions"]] == ["盒马鲜生", "海底捞", "上海地铁"]
    first = body["transactions"][0]
    assert first["amount"] == "35.50"
    assert first["category_id"] == ledger.groceries and first["category_name"] == "买菜"
    assert first["parent_category_id"] == ledger.food and first["parent_category_name"] == "餐饮"
    assert first["confirmed_duplicate"] is False
    assert "fingerprint" not in first

    listed = client.get(f"{ledger.base}/transactions").json()
    assert listed["total"] == 3
    # Newest first.
    assert [t["counterparty"] for t in listed["items"]] == ["上海地铁", "海底捞", "盒马鲜生"]
    assert listed["items"][1]["note"] == "生日"

    detail = client.get(f"{ledger.base}/summary/months/2026-09").json()
    assert detail["actual"] == "327.50"

    from app.db import get_engine

    with get_engine().connect() as connection:
        token_ids = set(connection.scalars(text("SELECT api_token_id FROM transactions")))
    assert token_ids == {token["id"]}


def test_unknown_category_rejects_whole_batch_with_valid_categories(client, ledger):
    """AC8, unknown category (including one that belongs to another account)."""
    other = Ledger(client, name="另一个账户")
    client.patch(f"{API}/categories/{ledger.metro}", json={"description": "含地铁卡充值"})
    tree = client.get(f"{ledger.base}/categories").json()["categories"]
    assert tree[1]["children"][0]["description"] == "含地铁卡充值"

    for bad_category in (99999, other.groceries):
        items = [
            ledger.item(),
            ledger.item(counterparty="未知", category_id=bad_category),
            ledger.item(counterparty="上海地铁", category_id=ledger.metro),
        ]
        response = ledger.submit(items)
        feedback = _rejected(response)
        assert response.json()["message"] == "本批共 3 条，其中 1 条被拒绝，未写入任何数据"
        assert [entry["index"] for entry in feedback] == [0, 1, 2]
        assert feedback[0] == {"index": 0, "status": "ok"}
        assert feedback[2] == {"index": 2, "status": "ok"}
        assert feedback[1]["status"] == "rejected"
        assert feedback[1]["code"] == "CATEGORY_NOT_FOUND"
        assert "分类" in feedback[1]["message"]
        assert feedback[1]["valid_categories"] == tree
        assert ledger.count() == 0


def test_level1_category_rejects_whole_batch_with_children(client, ledger):
    """AC8, level-1 category. The children carry their description for the agent."""
    described = client.patch(f"{API}/categories/{ledger.groceries}", json={"description": "生鲜"})
    assert described.status_code == 200
    response = ledger.submit([ledger.item(category_id=ledger.food), ledger.item(counterparty="b")])
    feedback = _rejected(response)
    assert feedback[0]["code"] == "CATEGORY_NOT_LEAF"
    assert "一级分类" in feedback[0]["message"]
    assert feedback[0]["parent"] == {"id": ledger.food, "name": "餐饮"}
    assert feedback[0]["children"] == [
        {"id": ledger.groceries, "name": "买菜", "description": "生鲜"},
        {"id": ledger.dining, "name": "外食", "description": None},
    ]
    assert feedback[1] == {"index": 1, "status": "ok"}
    assert ledger.count() == 0


def test_resubmission_is_a_suspected_duplicate_until_confirmed(client, ledger):
    """AC9"""
    stored = ledger.submit([ledger.item()]).json()["transactions"][0]

    # Same content, differently formatted, plus a new item: nothing is written.
    again = ledger.item(counterparty="  盒马鲜生 ", description="支付宝消费", amount="35.5")
    response = ledger.submit([again, ledger.item(counterparty="新商户")])
    feedback = _rejected(response)
    assert feedback[0]["code"] == "SUSPECTED_DUPLICATE"
    assert feedback[0]["existing"] == stored
    assert "confirm_duplicate=true" in feedback[0]["hint"]
    assert "疑似重复" in feedback[0]["message"]
    assert feedback[1] == {"index": 1, "status": "ok"}
    assert ledger.count() == 1

    # Re-running the batch unchanged still writes nothing.
    _rejected(ledger.submit([again, ledger.item(counterparty="新商户")]))
    assert ledger.count() == 1

    confirmed = ledger.submit([ledger.item(confirm_duplicate=True)])
    assert confirmed.status_code == 201
    second = confirmed.json()["transactions"][0]
    assert second["id"] != stored["id"]
    assert second["confirmed_duplicate"] is True
    assert ledger.count() == 2


def test_confirmation_flag_is_ignored_without_a_match(client, ledger):
    response = ledger.submit([ledger.item(confirm_duplicate=True)])
    assert response.status_code == 201
    assert response.json()["transactions"][0]["confirmed_duplicate"] is False


def test_same_content_in_another_account_is_not_a_duplicate(client, ledger):
    other = Ledger(client, name="另一个账户")
    assert ledger.submit([ledger.item()]).status_code == 201
    assert other.submit([other.item()]).status_code == 201


def test_identical_items_in_one_batch_are_rejected(client, ledger):
    """AC10"""
    response = ledger.submit([ledger.item(), ledger.item(counterparty="别家"), ledger.item()])
    feedback = _rejected(response)
    assert feedback[0] == {"index": 0, "status": "ok"}
    assert feedback[2]["code"] == "DUPLICATE_IN_BATCH"
    assert feedback[2]["duplicate_of_index"] == 0
    assert "index=0" in feedback[2]["message"]
    assert ledger.count() == 0

    # Flagging the repeat stores both, the repeat marked as a confirmed duplicate.
    confirmed = ledger.submit([ledger.item(), ledger.item(confirm_duplicate=True)])
    assert confirmed.status_code == 201
    assert [t["confirmed_duplicate"] for t in confirmed.json()["transactions"]] == [False, True]
    assert ledger.count() == 2


def test_refund_reduces_the_category_actual(client, ledger):
    """AC11"""
    items = [
        ledger.item(amount="200.00"),
        ledger.item(amount="-50.25", description="退款"),
        ledger.item(amount="-10", description="退款", date="2026-10-02"),
    ]
    assert ledger.submit(items).status_code == 201

    september = client.get(f"{ledger.base}/summary/months/2026-09").json()
    food = september["categories"][0]
    assert food["actual"] == "149.75"
    assert food["children"][0] == {
        "category_id": ledger.groceries,
        "name": "买菜",
        "budget": None,
        "actual": "149.75",
    }
    # The refund counts in the month of its own date.
    october = client.get(f"{ledger.base}/summary/months/2026-10").json()
    assert october["categories"][0]["children"][0]["actual"] == "-10.00"


def test_invalid_fields_are_reported_per_item(client, ledger):
    items = [
        ledger.item(amount=0),
        ledger.item(date="2026-02-30"),
        ledger.item(amount="1.005"),
        ledger.item(counterparty="   "),
        {"date": "2026-09-01", "amount": "5"},
        ledger.item(confirm_duplicates=True),
        ledger.item(counterparty="正常"),
    ]
    feedback = _rejected(ledger.submit(items))
    assert [entry.get("code") for entry in feedback] == ["INVALID_FIELD"] * 6 + [None]
    fields = [{error["field"] for error in entry["errors"]} for entry in feedback[:6]]
    assert fields == [
        {"amount"},
        {"date"},
        {"amount"},
        {"counterparty"},
        {"counterparty", "category_id"},
        {"confirm_duplicates"},
    ]
    assert all(error["reason"] for entry in feedback[:6] for error in entry["errors"])
    assert "字段无效" in feedback[0]["message"]
    assert ledger.submit(items).json()["message"].startswith("本批共 7 条，其中 6 条被拒绝")
    assert ledger.count() == 0


def test_nul_characters_are_an_invalid_field_not_a_server_error(client, ledger):
    """PostgreSQL cannot store U+0000; the item is rejected with feedback like any
    other bad field instead of failing the INSERT."""
    items = [
        ledger.item(counterparty="商\x00户"),
        ledger.item(description="描\x00述"),
        ledger.item(note="备\x00注"),
        ledger.item(counterparty="正常"),
    ]
    feedback = _rejected(ledger.submit(items))
    assert [entry.get("code") for entry in feedback] == ["INVALID_FIELD"] * 3 + [None]
    fields = [{error["field"] for error in entry["errors"]} for entry in feedback[:3]]
    assert fields == [{"counterparty"}, {"description"}, {"note"}]
    assert ledger.count() == 0

    stored = ledger.submit([ledger.item()]).json()["transactions"][0]
    patched = client.patch(f"{API}/transactions/{stored['id']}", json={"note": "备\x00注"})
    assert_envelope(patched, 422, "VALIDATION_ERROR")


def test_database_failure_during_insert_leaves_nothing_behind(app, client, ledger):
    """All-or-nothing also holds when the database itself refuses a row after the batch
    passed validation: no row survives and the account lock is released."""
    from app.db import get_engine

    constraint = "ck_test_refuse_boom"
    with get_engine().begin() as connection:
        connection.execute(
            text(
                f"ALTER TABLE transactions ADD CONSTRAINT {constraint}"
                " CHECK (counterparty <> 'boom')"
            )
        )
    try:
        tolerant = TestClient(app, cookies=dict(client.cookies), raise_server_exceptions=False)
        items = [
            ledger.item(counterparty="之前"),
            ledger.item(counterparty="boom"),
            ledger.item(counterparty="之后"),
        ]
        failed = ledger.submit(items, client=tolerant)
        assert_envelope(failed, 500, "INTERNAL_ERROR")
        assert ledger.count() == 0
    finally:
        with get_engine().begin() as connection:
            connection.execute(text(f"ALTER TABLE transactions DROP CONSTRAINT {constraint}"))

    # The failed request's transaction is gone, so the lock is free and nothing of the
    # batch counts as already stored.
    assert ledger.submit(items).status_code == 201
    assert ledger.count() == 3


def test_batch_size_limits(client, ledger):
    assert_envelope(ledger.submit([]), 422, "INVALID_BATCH_SIZE")
    too_many = [ledger.item(counterparty=f"商户{i}") for i in range(501)]
    assert_envelope(ledger.submit(too_many), 422, "INVALID_BATCH_SIZE")
    assert ledger.count() == 0
    limit = ledger.submit(too_many[:500])
    assert limit.status_code == 201 and ledger.count() == 500

    assert_envelope(
        client.post(f"{ledger.base}/transactions/batch", json={}), 422, "VALIDATION_ERROR"
    )
    missing = client.post(f"{API}/accounts/999/transactions/batch", json={"items": [ledger.item()]})
    assert_envelope(missing, 404, "ACCOUNT_NOT_FOUND")


def test_fingerprint_normalisation():
    assert normalize_text("  Ｓtarbucks　 Coffee\n") == "starbucks coffee"
    day = date(2026, 9, 15)
    base = compute_fingerprint(1, day, Decimal("35.5"), "Starbucks  Coffee", "LATTE")
    assert base == compute_fingerprint(1, day, Decimal("35.50"), " starbucks coffee ", "latte")
    assert base != compute_fingerprint(2, day, Decimal("35.50"), "starbucks coffee", "latte")
    assert base != compute_fingerprint(1, day, Decimal("35.51"), "starbucks coffee", "latte")
    assert base != compute_fingerprint(1, day, Decimal("-35.50"), "starbucks coffee", "latte")
    assert base != compute_fingerprint(1, day, Decimal("35.50"), "starbucks", "coffee latte")


def test_list_filters_and_pagination(client, ledger):
    items = [
        ledger.item(counterparty=f"商户{i}", date=f"2026-09-{i + 1:02d}") for i in range(5)
    ] + [
        ledger.item(counterparty="海底捞", category_id=ledger.dining, date="2026-08-20"),
        ledger.item(counterparty="上海地铁", category_id=ledger.metro, date="2026-08-21"),
    ]
    assert ledger.submit(items).status_code == 201
    url = f"{ledger.base}/transactions"

    assert client.get(url, params={"month": "2026-09"}).json()["total"] == 5
    assert client.get(url, params={"month": "2026-08"}).json()["total"] == 2
    assert client.get(url, params={"category_id": ledger.dining}).json()["total"] == 1
    # A level-1 category matches all of its children.
    assert client.get(url, params={"category_id": ledger.food}).json()["total"] == 6
    both = client.get(url, params={"category_id": ledger.food, "month": "2026-08"}).json()
    assert [t["counterparty"] for t in both["items"]] == ["海底捞"]

    page = client.get(url, params={"month": "2026-09", "page": 2, "page_size": 2}).json()
    assert (page["total"], page["page"], page["page_size"]) == (5, 2, 2)
    assert [t["date"] for t in page["items"]] == ["2026-09-03", "2026-09-02"]

    assert_envelope(client.get(url, params={"category_id": 9999}), 422, "CATEGORY_NOT_FOUND")
    assert_envelope(client.get(url, params={"page_size": 1000}), 422, "VALIDATION_ERROR")


def test_edit_category_and_note_then_delete(client, ledger):
    """AC14 backend: the change shows up in the list and in the summaries."""
    other = Ledger(client, name="另一个账户")
    stored = ledger.submit([ledger.item(amount="100")]).json()["transactions"][0]
    url = f"{API}/transactions/{stored['id']}"

    moved = client.patch(url, json={"category_id": ledger.metro, "note": "其实是车费"})
    assert moved.status_code == 200
    assert moved.json() == {
        **stored,
        "category_id": ledger.metro,
        "category_name": "地铁",
        "parent_category_id": ledger.transport,
        "parent_category_name": "交通",
        "note": "其实是车费",
    }
    rows = {
        row["name"]: row["actual"]
        for row in client.get(f"{ledger.base}/summary/months/2026-09").json()["categories"]
    }
    assert rows == {"餐饮": "0.00", "交通": "100.00"}

    # Omitted fields are untouched; an explicit null clears the note.
    assert client.patch(url, json={}).json()["note"] == "其实是车费"
    assert client.patch(url, json={"note": None}).json()["note"] is None
    assert client.patch(url, json={"note": "x"}).json()["category_id"] == ledger.metro

    assert_envelope(client.patch(url, json={"category_id": ledger.food}), 422, "CATEGORY_NOT_LEAF")
    cross_account = client.patch(url, json={"category_id": other.metro})
    assert_envelope(cross_account, 422, "CATEGORY_NOT_FOUND")
    assert_envelope(client.patch(url, json={"category_id": None}), 422, "CATEGORY_NOT_FOUND")
    # Amount, date and counterparty are not editable.
    for field, value in {"amount": "1", "date": "2026-01-01", "counterparty": "x"}.items():
        assert_envelope(client.patch(url, json={field: value}), 422, "VALIDATION_ERROR")

    assert client.delete(url).status_code == 204
    assert ledger.count() == 0
    monthly = client.get(f"{ledger.base}/summary/monthly?from=2026-09&to=2026-09").json()
    assert monthly["months"] == [{"month": "2026-09", "budget": None, "actual": "0.00"}]
    assert_envelope(client.delete(url), 404, "TRANSACTION_NOT_FOUND")
    assert_envelope(client.patch(url, json={"note": "x"}), 404, "TRANSACTION_NOT_FOUND")
