"""An agent's category changes (task 10-19-agent-recategorize): it finds stored
transactions with `GET /transactions/search` and changes their category with
`POST /transactions/recategorize`, each change with a reason appended to the note."""

from tests.test_auth import API, assert_envelope
from tests.test_refunds import by_id, leaves, match, store

SEARCH = f"{API}/transactions/search"
RECATEGORIZE = f"{API}/transactions/recategorize"
SEPTEMBER = {"date_from": "2026-09-01", "date_to": "2026-09-30"}


def change(transaction_id: int, category_id: int, reason: str = "实为打车") -> dict:
    return {"transaction_id": transaction_id, "category_id": category_id, "reason": reason}


def test_search_finds_payments_and_refunds(client, agent, ledger):
    """AC1: payments and refunds, by date, channel, category (level 1 or 2), keyword and
    kind; a matched refund is found by its payment's category; same bounds as the payment
    search."""
    card = ledger.add_channel("信用卡")
    paid, matched, loose, metro = store(
        ledger,
        [
            ledger.item(date="2026-09-01", amount="100", counterparty="盒马"),
            ledger.item(date="2026-09-02", amount="-30", category_id=ledger.metro),
            ledger.item(
                date="2026-09-03", amount="-5", counterparty="美团", description="外卖退款"
            ),
            ledger.item(
                date="2026-09-04", amount="4", counterparty="地铁", category_id=ledger.metro
            ),
        ],
    )
    fresh = store(
        ledger, [ledger.item(date="2026-09-05", amount="40", counterparty="盒马Fresh")], card
    )[0]
    assert match(client, matched, paid["id"]).status_code == 200

    def ids(**params) -> list[int]:
        response = agent.get(SEARCH, params={**SEPTEMBER, **params})
        assert response.status_code == 200, response.text
        return [t["id"] for t in response.json()["transactions"]]

    everything = [fresh["id"], metro["id"], loose["id"], matched["id"], paid["id"]]
    assert ids() == everything
    assert ids(kind="payment") == [fresh["id"], metro["id"], paid["id"]]
    assert ids(kind="refund") == [loose["id"], matched["id"]]
    assert ids(channel_id=card) == [fresh["id"]]
    assert ids(category_id=ledger.metro) == [metro["id"]]  # the matched refund counts in 买菜
    assert ids(category_id=ledger.food) == [fresh["id"], loose["id"], matched["id"], paid["id"]]
    assert ids(q="外卖") == [loose["id"]]
    assert ids(q="盒马fresh") == [fresh["id"]]
    assert ids(limit=2) == everything[:2]

    body = agent.get(SEARCH, params=SEPTEMBER).json()
    assert body == client.get(SEARCH, params=SEPTEMBER).json()
    assert body["transactions"][3]["refund_of"]["id"] == paid["id"]
    assert body["transactions"][3]["category_id"] == ledger.groceries

    for params, code in (
        ({"limit": 0}, "INVALID_LIMIT"),
        ({"limit": 51}, "INVALID_LIMIT"),
        ({"date_from": "2026-09-02", "date_to": "2026-09-01"}, "INVALID_DATE_RANGE"),
        ({"date_from": "2025-09-01", "date_to": "2026-09-02"}, "INVALID_DATE_RANGE"),
        ({"channel_id": 999}, "CHANNEL_NOT_FOUND"),
        ({"category_id": 999}, "CATEGORY_NOT_FOUND"),
        ({"kind": "income"}, "VALIDATION_ERROR"),
    ):
        assert_envelope(agent.get(SEARCH, params={**SEPTEMBER, **params}), 422, code)


def test_recategorize_appends_the_reason(client, agent, ledger):
    """AC2: the category changes, the note keeps what it had and gains one line per
    change, and the summaries count the transaction in its new category."""
    noted, bare = store(
        ledger,
        [
            ledger.item(note="USD 16.90"),
            ledger.item(date="2026-09-16", amount="12", counterparty="滴滴"),
        ],
    )
    response = agent.post(
        RECATEGORIZE,
        json={
            "items": [
                change(noted["id"], ledger.dining, "  在店里吃的  "),
                change(bare["id"], ledger.metro),
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["accepted"] is True
    assert [(t["id"], t["category_id"], t["note"]) for t in body["transactions"]] == [
        (noted["id"], ledger.dining, "USD 16.90\n[Agent 改分类] 餐饮/买菜 → 餐饮/外食：在店里吃的"),
        (bare["id"], ledger.metro, "[Agent 改分类] 餐饮/买菜 → 交通/地铁：实为打车"),
    ]
    assert by_id(client, bare["id"]) == body["transactions"][1]
    september = leaves(client, "2026-09")
    assert september[ledger.groceries] == ("0.00", 0)
    assert september[ledger.dining] == ("35.50", 1)
    assert september[ledger.metro] == ("12.00", 1)

    again = agent.post(RECATEGORIZE, json={"items": [change(bare["id"], ledger.groceries, "改回")]})
    assert again.json()["transactions"][0]["note"] == (
        "[Agent 改分类] 餐饮/买菜 → 交通/地铁：实为打车\n[Agent 改分类] 交通/地铁 → 餐饮/买菜：改回"
    )


def test_any_rejection_changes_nothing(client, agent, ledger):
    """AC3: each rejection code, and a rejected batch leaves every transaction as it was."""
    paid, refund, plain, other, long_note = store(
        ledger,
        [
            ledger.item(date="2026-09-01", amount="100"),
            ledger.item(date="2026-09-02", amount="-30"),
            ledger.item(date="2026-09-03", amount="8", counterparty="地铁"),
            ledger.item(date="2026-09-05", amount="7", counterparty="其他"),
            ledger.item(date="2026-09-04", amount="9", note="x" * 990),
        ],
    )
    assert match(client, refund, paid["id"]).status_code == 200
    before = {t["id"]: t for t in client.get(f"{API}/transactions").json()["items"]}

    response = agent.post(
        RECATEGORIZE,
        json={
            "items": [
                change(plain["id"], ledger.metro),
                change(plain["id"], ledger.dining),
                change(999_999, ledger.metro),
                change(paid["id"], 999_999),
                change(other["id"], ledger.transport),
                change(refund["id"], ledger.metro),
                change(long_note["id"], ledger.groceries),
                change(long_note["id"], ledger.metro),
                {"transaction_id": refund["id"], "category_id": ledger.metro},
            ]
        },
    )
    body = assert_envelope(response, 409, "BATCH_REJECTED")
    codes = [(item["status"], item.get("code")) for item in body["details"]["items"]]
    assert codes == [
        ("ok", None),
        ("rejected", "DUPLICATE_TRANSACTION"),
        ("rejected", "TRANSACTION_NOT_FOUND"),
        ("rejected", "CATEGORY_NOT_FOUND"),
        ("rejected", "CATEGORY_NOT_LEAF"),
        ("rejected", "REFUND_CATEGORY_FOLLOWS_PAYMENT"),
        ("rejected", "CATEGORY_UNCHANGED"),
        ("rejected", "DUPLICATE_TRANSACTION"),
        ("rejected", "INVALID_FIELD"),
    ]
    after = {t["id"]: t for t in client.get(f"{API}/transactions").json()["items"]}
    assert after == before

    too_long = agent.post(RECATEGORIZE, json={"items": [change(long_note["id"], ledger.metro)]})
    item = assert_envelope(too_long, 409, "BATCH_REJECTED")["details"]["items"][0]
    assert (item["code"], item["max_length"]) == ("NOTE_TOO_LONG", 1000)
    assert by_id(client, long_note["id"]) == before[long_note["id"]]

    for items in ([], [change(plain["id"], ledger.metro)] * 101):
        assert_envelope(agent.post(RECATEGORIZE, json={"items": items}), 422, "INVALID_BATCH_SIZE")


def test_reason_is_required(agent, ledger):
    """AC4: a missing, blank or over-long reason is INVALID_FIELD."""
    stored = store(ledger, [ledger.item()])[0]
    for reason in (None, "", "   ", "原" * 201, "a\x00b"):
        item = {"transaction_id": stored["id"], "category_id": ledger.metro}
        if reason is not None:
            item["reason"] = reason
        response = agent.post(RECATEGORIZE, json={"items": [item]})
        rejected = assert_envelope(response, 409, "BATCH_REJECTED")["details"]["items"][0]
        assert rejected["code"] == "INVALID_FIELD", reason
        assert rejected["errors"][0]["field"] == "reason"
    ok = agent.post(RECATEGORIZE, json={"items": [change(stored["id"], ledger.metro, "原" * 200)]})
    assert ok.status_code == 200, ok.text


def test_agent_still_cannot_edit_or_delete(client, agent, ledger):
    """AC5, AC6: the token still cannot use PATCH or DELETE; the user's PATCH needs no
    reason and leaves the note alone."""
    stored = store(ledger, [ledger.item(note="原备注")])[0]
    url = f"{API}/transactions/{stored['id']}"
    assert_envelope(
        agent.patch(url, json={"category_id": ledger.metro}), 403, "TOKEN_SCOPE_FORBIDDEN"
    )
    assert_envelope(agent.delete(url), 403, "TOKEN_SCOPE_FORBIDDEN")
    edited = client.patch(url, json={"category_id": ledger.metro})
    assert edited.status_code == 200, edited.text
    assert (edited.json()["category_id"], edited.json()["note"]) == (ledger.metro, "原备注")
