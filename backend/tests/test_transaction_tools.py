"""The transactions page's tools (task 10-23-actual-inspired, R1, R2, R4.5): search,
amount, date and tag filters with matching stats; tags; bulk update; delete, bulk delete
and restore."""

from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope
from tests.test_refunds import leaves, listed, match, store

TX = f"{API}/transactions"


def ids(body: dict) -> list[int]:
    return [row["id"] for row in body["items"]]


def seed(ledger: Ledger) -> list[dict]:
    return store(
        ledger,
        [
            ledger.item(
                date="2026-09-01", amount="4.00", counterparty="上海地铁", description="进站"
            ),
            ledger.item(
                date="2026-09-02",
                amount="120.00",
                counterparty="海底捞",
                description="晚餐",
                category_id=ledger.dining,
                note="#国庆2026 和家人",
            ),
            ledger.item(
                date="2026-09-03",
                amount="88.00",
                counterparty="盒马",
                description="买菜 地铁站店",
                note="#聚餐",
            ),
            ledger.item(
                date="2026-10-01", amount="6500.00", counterparty="自如", description="房租"
            ),
        ],
    )


def test_search_amount_and_date_filters_with_matching_stats(client, ledger):
    """AC1: q matches counterparty, description or note; stats follow the filters."""
    metro, dinner, groceries, rent = seed(ledger)

    body = listed(client, q="地铁")
    assert ids(body) == [groceries["id"], metro["id"]]
    assert body["stats"] == {"count": 2, "net_amount": "92.00"}
    assert ids(listed(client, q="家人")) == [dinner["id"]]
    assert ids(listed(client, q="%")) == []

    body = listed(client, amount_min="50", amount_max="200")
    assert ids(body) == [groceries["id"], dinner["id"]]
    assert body["stats"]["net_amount"] == "208.00"

    body = listed(client, date_from="2026-09-02", date_to="2026-09-03")
    assert ids(body) == [groceries["id"], dinner["id"]]
    assert body["stats"]["net_amount"] == "208.00"
    assert ids(listed(client, month="2026-09", date_from="2026-09-03")) == [groceries["id"]]
    assert_envelope(
        client.get(TX, params={"month": "2026-09", "date_from": "2026-10-01"}),
        422,
        "INVALID_DATE_RANGE",
    )
    assert rent["id"] in ids(listed(client, amount_min="6500"))


def test_tag_filter_follows_the_payment_of_a_matched_refund(client, ledger):
    """AC4: tags any-of; a matched refund carries its payment's tags."""
    _, dinner, groceries, _ = seed(ledger)
    [refund] = store(
        ledger,
        [ledger.item(date="2026-09-05", amount="-20.00", counterparty="海底捞", description="退")],
    )
    assert match(client, refund, dinner["id"]).status_code == 200

    body = listed(client, tag="国庆2026")
    assert ids(body) == [refund["id"], dinner["id"]]
    assert body["stats"] == {"count": 1, "net_amount": "100.00"}
    assert set(ids(listed(client, tag=["国庆2026", "聚餐"]))) == {
        refund["id"],
        dinner["id"],
        groceries["id"],
    }
    assert ids(listed(client, tag="国庆")) == []


def test_tags_are_listed_and_renamed_and_the_rename_can_be_undone(client, ledger):
    """AC4: rename touches whole tags only and returns what to restore."""
    _, dinner, groceries, _ = seed(ledger)
    client.patch(f"{TX}/{groceries['id']}", json={"note": "#国庆2026 #聚餐 ##国庆2026"})

    tags = client.get(f"{TX}/tags").json()
    assert tags == [{"tag": "国庆2026", "count": 2}, {"tag": "聚餐", "count": 1}]

    response = client.post(f"{TX}/tags/rename", json={"from_tag": "国庆2026", "to_tag": "国庆"})
    assert response.status_code == 200, response.text
    changed = response.json()["changed"]
    assert {c["transaction_id"] for c in changed} == {dinner["id"], groceries["id"]}
    notes = {row["id"]: row["note"] for row in listed(client)["items"]}
    assert notes[groceries["id"]] == "#国庆 #聚餐 ##国庆2026"
    assert notes[dinner["id"]] == "#国庆 和家人"

    undo = client.post(
        f"{TX}/bulk-update",
        json={
            "items": [
                {"transaction_id": c["transaction_id"], "note": c["note_before"]} for c in changed
            ]
        },
    )
    assert undo.status_code == 200, undo.text
    notes = {row["id"]: row["note"] for row in listed(client)["items"]}
    assert notes[dinner["id"]] == "#国庆2026 和家人"

    assert_envelope(
        client.post(f"{TX}/tags/rename", json={"from_tag": "没有", "to_tag": "x"}),
        404,
        "TAG_NOT_FOUND",
    )
    for bad in ["两 词", "a#b", "国庆2026"]:
        assert_envelope(
            client.post(f"{TX}/tags/rename", json={"from_tag": "国庆2026", "to_tag": bad}),
            422,
            "INVALID_TAG",
        )


def test_bulk_update_is_all_or_nothing_and_keeps_notes(client, ledger):
    """AC3: batch recategorize changes nothing else; one bad item rejects the batch."""
    metro, dinner, groceries, _ = seed(ledger)
    [refund] = store(
        ledger,
        [ledger.item(date="2026-09-05", amount="-20.00", counterparty="海底捞", description="退")],
    )
    match(client, refund, dinner["id"])

    rejected = client.post(
        f"{TX}/bulk-update",
        json={
            "items": [
                {"transaction_id": metro["id"], "category_id": ledger.dining},
                {"transaction_id": refund["id"], "category_id": ledger.metro},
                {"transaction_id": groceries["id"], "category_id": ledger.food},
            ]
        },
    )
    body = assert_envelope(rejected, 409, "BATCH_REJECTED")
    assert [item["status"] for item in body["details"]["items"]] == ["ok", "rejected", "rejected"]
    assert body["details"]["items"][1]["code"] == "REFUND_CATEGORY_FOLLOWS_PAYMENT"
    assert body["details"]["items"][2]["code"] == "CATEGORY_NOT_LEAF"

    response = client.post(
        f"{TX}/bulk-update",
        json={
            "items": [
                {"transaction_id": metro["id"], "category_id": ledger.dining},
                {"transaction_id": groceries["id"], "category_id": ledger.dining},
            ]
        },
    )
    assert response.status_code == 200, response.text
    rows = response.json()["transactions"]
    assert [row["category_id"] for row in rows] == [ledger.dining, ledger.dining]
    assert rows[1]["note"] == "#聚餐"
    assert leaves(client, "2026-09")[ledger.dining] == ("192.00", 3)

    assert (
        client.post(f"{TX}/bulk-update", json={"items": [{"transaction_id": 1}]}).status_code == 422
    )


def test_delete_then_restore_puts_back_the_same_row(client, ledger):
    """AC9: a deleted matched refund comes back with its id, match and figures."""
    _, dinner, _, _ = seed(ledger)
    [refund] = store(
        ledger,
        [ledger.item(date="2026-09-05", amount="-20.00", counterparty="海底捞", description="退")],
    )
    match(client, refund, dinner["id"])
    before = leaves(client, "2026-09")
    original = next(row for row in listed(client)["items"] if row["id"] == refund["id"])

    assert client.delete(f"{TX}/{refund['id']}").status_code == 204
    assert leaves(client, "2026-09") != before

    response = client.post(f"{TX}/restore", json={"ids": [refund["id"]]})
    assert response.status_code == 200, response.text
    assert response.json()["transactions"] == [original]
    assert leaves(client, "2026-09") == before

    # Restoring twice: the copy is gone.
    body = assert_envelope(
        client.post(f"{TX}/restore", json={"ids": [refund["id"]]}), 409, "RESTORE_CONFLICT"
    )
    assert body["details"]["items"][0]["reason"] == "TRASH_EXPIRED"
    # The duplicate check still sees the restored row.
    resubmit = ledger.submit(
        [ledger.item(date="2026-09-05", amount="-20.00", counterparty="海底捞", description="退")]
    )
    assert resubmit.status_code == 409


def test_restore_refuses_a_refund_whose_payment_is_gone_or_refunded(client, ledger):
    """AC9: undoing a refund's delete is refused when its payment cannot take it back."""
    _, dinner, _, _ = seed(ledger)
    first, second = store(
        ledger,
        [
            ledger.item(
                date="2026-09-05", amount="-100.00", counterparty="海底捞", description="退1"
            ),
            ledger.item(
                date="2026-09-06", amount="-30.00", counterparty="海底捞", description="退2"
            ),
        ],
    )
    match(client, first, dinner["id"])
    client.delete(f"{TX}/{first['id']}")
    match(client, second, dinner["id"])  # 30 of 120 refunded: 100 more would exceed it
    body = assert_envelope(
        client.post(f"{TX}/restore", json={"ids": [first["id"]]}), 409, "RESTORE_CONFLICT"
    )
    assert body["details"]["items"][0]["reason"] == "REFUND_EXCEEDS_PAYMENT"

    client.delete(f"{TX}/{second['id']}")
    client.delete(f"{TX}/{dinner['id']}")
    body = assert_envelope(
        client.post(f"{TX}/restore", json={"ids": [first["id"]]}), 409, "RESTORE_CONFLICT"
    )
    assert body["details"]["items"][0]["reason"] == "REFUND_TARGET_GONE"
    # Payment and refund together come back.
    response = client.post(f"{TX}/restore", json={"ids": [first["id"], dinner["id"]]})
    assert response.status_code == 200, response.text
    assert listed(client, tag="国庆2026")["stats"]["net_amount"] == "20.00"


def test_bulk_delete_takes_a_payment_only_with_its_refunds(client, ledger):
    metro, dinner, _, _ = seed(ledger)
    [refund] = store(
        ledger,
        [ledger.item(date="2026-09-05", amount="-20.00", counterparty="海底捞", description="退")],
    )
    match(client, refund, dinner["id"])

    body = assert_envelope(
        client.post(f"{TX}/bulk-delete", json={"ids": [dinner["id"], metro["id"]]}),
        409,
        "TRANSACTION_HAS_REFUNDS",
    )
    assert body["details"]["refund_ids"] == [refund["id"]]
    assert_envelope(
        client.post(f"{TX}/bulk-delete", json={"ids": [metro["id"], 9999]}),
        404,
        "TRANSACTION_NOT_FOUND",
    )
    assert ledger.count() == 5

    deleted = [dinner["id"], refund["id"], metro["id"]]
    assert client.post(f"{TX}/bulk-delete", json={"ids": deleted}).status_code == 204
    assert ledger.count() == 2
    response = client.post(f"{TX}/restore", json={"ids": deleted})
    assert response.status_code == 200, response.text
    assert ledger.count() == 5
    assert next(r for r in listed(client)["items"] if r["id"] == refund["id"])["refund_of"]
