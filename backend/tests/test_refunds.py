"""Refund matching (task 10-12-refund-matching): a refund matched to a payment counts in
the payment's month and category, payments are counted by their net amount, and the
transaction list, the summaries, the batch submission and the payment search agree."""

from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope

TX = f"{API}/transactions"


def store(ledger: Ledger, items: list[dict], channel_id: int | None = None) -> list[dict]:
    response = ledger.submit(items, channel_id=channel_id)
    assert response.status_code == 201, response.text
    return response.json()["transactions"]


def match(client, refund: dict, payment_id: int | None):
    return client.patch(f"{TX}/{refund['id']}", json={"refund_of_id": payment_id})


def leaves(client, month: str, **params) -> dict[int, tuple[str, int]]:
    """(actual, count) of every level-2 row of the month detail."""
    body = client.get(f"{API}/summary/months/{month}", params=params).json()
    return {
        child["category_id"]: (child["actual"], child["count"])
        for row in body["categories"]
        for child in row["children"]
    }


def listed(client, **params) -> dict:
    response = client.get(TX, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def by_id(client, transaction_id: int) -> dict:
    return next(t for t in listed(client, page_size=200)["items"] if t["id"] == transaction_id)


def test_matched_refund_counts_in_the_payment_month_and_category(client, ledger):
    """AC1, AC2: a March refund matched to a February payment reduces February, in the
    payment's category (not the refund's own), follows the payment to a new category, and
    goes back to March and its own category when the match is removed."""
    payment, refund = store(
        ledger,
        [
            ledger.item(date="2026-02-10", amount="100", counterparty="盒马"),
            ledger.item(
                date="2026-03-05",
                amount="-30",
                counterparty="盒马",
                description="退款",
                category_id=ledger.dining,
            ),
        ],
    )
    assert refund["refund_of"] is None and refund["refunded"] == "0.00"
    assert payment["refunded"] == "0.00"
    assert leaves(client, "2026-02")[ledger.groceries] == ("100.00", 1)
    assert leaves(client, "2026-03")[ledger.dining] == ("-30.00", 0)

    matched = match(client, refund, payment["id"])
    assert matched.status_code == 200, matched.text
    body = matched.json()
    assert body["refund_of"] == {
        "id": payment["id"],
        "date": "2026-02-10",
        "amount": "100.00",
        "counterparty": "盒马",
        "category_name": "买菜",
    }
    # The effective category is shown; the refund's own date and amount are not touched.
    assert (body["category_id"], body["category_name"]) == (ledger.groceries, "买菜")
    assert (body["date"], body["amount"]) == ("2026-03-05", "-30.00")
    assert by_id(client, payment["id"])["refunded"] == "30.00"

    february, march = leaves(client, "2026-02"), leaves(client, "2026-03")
    assert february[ledger.groceries] == ("70.00", 1)
    assert february[ledger.dining] == ("0.00", 0)
    assert march[ledger.dining] == ("0.00", 0)
    assert march[ledger.groceries] == ("0.00", 0)
    series = client.get(f"{API}/summary/monthly", params={"from": "2026-02", "to": "2026-03"})
    assert [m["actual"] for m in series.json()["months"]] == ["70.00", "0.00"]

    # The payment changes category: its refund follows without being rewritten.
    moved = client.patch(f"{TX}/{payment['id']}", json={"category_id": ledger.metro})
    assert moved.status_code == 200
    february = leaves(client, "2026-02")
    assert february[ledger.metro] == ("70.00", 1)
    assert february[ledger.groceries] == ("0.00", 0)
    shown = by_id(client, refund["id"])
    assert shown["category_id"] == ledger.metro
    assert shown["refund_of"]["category_name"] == "地铁"

    # Removing the match: the refund's own category (never overwritten) applies again.
    unmatched = match(client, refund, None)
    assert unmatched.status_code == 200
    assert unmatched.json()["refund_of"] is None
    assert unmatched.json()["category_id"] == ledger.dining
    assert leaves(client, "2026-02")[ledger.metro] == ("100.00", 1)
    assert leaves(client, "2026-03")[ledger.dining] == ("-30.00", 0)
    assert by_id(client, payment["id"])["refunded"] == "0.00"


def test_partial_repeated_and_full_refunds(client, ledger):
    """AC3, AC4: two refunds of one payment are fine up to its amount and rejected beyond
    it (nothing changes); a fully refunded payment is no longer counted, a partly refunded
    one still is; unmatched refunds and refund rows never change the count."""
    a, b, r1, r2, r3, lone = store(
        ledger,
        [
            ledger.item(date="2026-09-01", amount="100", counterparty="A"),
            ledger.item(date="2026-09-02", amount="50", counterparty="B"),
            ledger.item(date="2026-09-05", amount="-40", counterparty="A"),
            ledger.item(date="2026-09-06", amount="-60", counterparty="A"),
            ledger.item(date="2026-09-07", amount="-10", counterparty="B"),
            ledger.item(date="2026-09-08", amount="-5", counterparty="X", category_id=ledger.metro),
        ],
    )
    # Unmatched refunds reduce the amount but not the count; a refund is never counted.
    assert leaves(client, "2026-09")[ledger.groceries] == ("40.00", 2)
    assert leaves(client, "2026-09")[ledger.metro] == ("-5.00", 0)

    assert match(client, r1, a["id"]).status_code == 200
    assert leaves(client, "2026-09")[ledger.groceries] == ("40.00", 2)  # a: 60 left
    assert match(client, r2, a["id"]).status_code == 200
    assert leaves(client, "2026-09")[ledger.groceries] == ("40.00", 1)  # a: fully refunded
    assert by_id(client, a["id"])["refunded"] == "100.00"

    over = assert_envelope(match(client, r3, a["id"]), 422, "REFUND_EXCEEDS_PAYMENT")
    assert over["details"] == {
        "refund_of_id": a["id"],
        "payment_amount": "100.00",
        "refunded": "100.00",
        "refundable": "0.00",
    }
    assert by_id(client, r3["id"])["refund_of"] is None
    assert by_id(client, a["id"])["refunded"] == "100.00"

    assert match(client, r3, b["id"]).status_code == 200  # partial: b still counts
    detail = client.get(f"{API}/summary/months/2026-09").json()
    assert leaves(client, "2026-09")[ledger.groceries] == ("40.00", 1)
    assert (detail["count"], detail["categories"][0]["count"]) == (1, 1)

    # Undoing a refund of a fully refunded payment brings its count back.
    assert match(client, r2, None).status_code == 200
    assert leaves(client, "2026-09")[ledger.groceries] == ("40.00", 2)
    assert lone["refund_of"] is None


def test_match_rules(client, ledger):
    """AC3 / AC8 rules: only a refund matches, only to a payment that exists, is not
    itself and is not dated after it; a matched refund's category follows the payment.
    Re-matching and removing in the same request as a category change work."""
    p, p_same_day, later, r, other_refund = store(
        ledger,
        [
            ledger.item(date="2026-09-10", amount="100", counterparty="P"),
            ledger.item(date="2026-09-15", amount="10", counterparty="同日"),
            ledger.item(date="2026-09-20", amount="20", counterparty="之后"),
            ledger.item(date="2026-09-15", amount="-10", counterparty="R"),
            ledger.item(date="2026-09-16", amount="-5", counterparty="R2"),
        ],
    )
    refused = [other_refund["id"], 999999, 2**31, r["id"], later["id"]]
    for target in refused:
        body = assert_envelope(match(client, r, target), 422, "INVALID_REFUND_TARGET")
        assert body["details"] == {"refund_of_id": target}
    assert (
        "晚于"
        in assert_envelope(match(client, r, later["id"]), 422, "INVALID_REFUND_TARGET")["message"]
    )
    # A payment cannot point at anything.
    assert_envelope(match(client, p, p_same_day["id"]), 422, "INVALID_REFUND_TARGET")
    assert by_id(client, r["id"])["refund_of"] is None
    assert by_id(client, p["id"])["refund_of"] is None

    # The same day is fine; then re-matching moves the refund to another payment.
    assert match(client, r, p_same_day["id"]).json()["refund_of"]["id"] == p_same_day["id"]
    assert match(client, r, p["id"]).json()["refund_of"]["id"] == p["id"]
    assert by_id(client, p_same_day["id"])["refunded"] == "0.00"
    assert by_id(client, p["id"])["refunded"] == "10.00"
    # Matching again to the same payment does not count the refund twice.
    full = store(ledger, [ledger.item(date="2026-09-15", amount="-90", counterparty="余额")])[0]
    assert match(client, full, p["id"]).status_code == 200
    assert match(client, full, p["id"]).status_code == 200

    url = f"{TX}/{r['id']}"
    follows = client.patch(url, json={"category_id": ledger.metro})
    body = assert_envelope(follows, 422, "REFUND_CATEGORY_FOLLOWS_PAYMENT")
    assert body["details"] == {"category_id": ledger.metro, "refund_of_id": p["id"]}
    also = client.patch(url, json={"category_id": ledger.metro, "refund_of_id": p["id"]})
    assert_envelope(also, 422, "REFUND_CATEGORY_FOLLOWS_PAYMENT")
    noted = client.patch(url, json={"note": "部分退款"})
    assert noted.json()["refund_of"]["id"] == p["id"] and noted.json()["note"] == "部分退款"

    freed = client.patch(url, json={"refund_of_id": None, "category_id": ledger.metro})
    assert freed.status_code == 200
    assert (freed.json()["refund_of"], freed.json()["category_id"]) == (None, ledger.metro)
    # Removing a match that is not there, or "removing" on a payment, is a no-op.
    assert match(client, r, None).status_code == 200
    assert match(client, p, None).status_code == 200


def test_payment_with_matched_refunds_cannot_be_deleted(client, ledger):
    """AC9 (backend): 409 TRANSACTION_HAS_REFUNDS until no refund points at it."""
    p, r1, r2 = store(
        ledger,
        [
            ledger.item(amount="100", counterparty="P"),
            ledger.item(amount="-10", counterparty="R1"),
            ledger.item(amount="-20", counterparty="R2"),
        ],
    )
    for refund in (r1, r2):
        assert match(client, refund, p["id"]).status_code == 200
    # The payment's refunds, as the edit dialog lists them; a refund has none.
    refunds = client.get(f"{TX}/{p['id']}/refunds").json()
    assert [(t["id"], t["refund_of"]["id"]) for t in refunds] == [
        (r1["id"], p["id"]),
        (r2["id"], p["id"]),
    ]
    assert client.get(f"{TX}/{r1['id']}/refunds").json() == []
    assert_envelope(client.get(f"{TX}/999999/refunds"), 404, "TRANSACTION_NOT_FOUND")
    refused = assert_envelope(client.delete(f"{TX}/{p['id']}"), 409, "TRANSACTION_HAS_REFUNDS")
    assert refused["details"] == {"refund_ids": [r1["id"], r2["id"]]}
    assert "取消匹配" in refused["message"]
    assert ledger.count() == 3

    assert match(client, r1, None).status_code == 200
    assert client.delete(f"{TX}/{r2['id']}").status_code == 204  # a refund: never refused
    assert client.get(f"{TX}/{p['id']}/refunds").json() == []
    assert client.delete(f"{TX}/{p['id']}").status_code == 204
    assert ledger.count() == 1


def test_list_stats_equal_the_summaries(client, ledger):
    """AC5 (backend): `stats` for a month and a category, a level-1 category or a budget
    account equal the month detail; rows stay in their own month, a matched refund's stats
    go to its payment's month and channel."""
    card = ledger.add_channel("信用卡")
    big = store(
        ledger,
        [ledger.item(date="2026-02-03", amount="200", counterparty="大件")],
        channel_id=card,
    )[0]
    rows = store(
        ledger,
        [
            ledger.item(
                date="2026-03-02", amount="-50", counterparty="大件", category_id=ledger.dining
            ),
            ledger.item(date="2026-02-05", amount="80", counterparty="买菜"),
            ledger.item(date="2026-02-06", amount="-5", counterparty="买菜退"),
            ledger.item(
                date="2026-02-07", amount="4", counterparty="地铁", category_id=ledger.metro
            ),
            ledger.item(
                date="2026-02-08", amount="30", counterparty="外卖", category_id=ledger.dining
            ),
            ledger.item(
                date="2026-02-09", amount="-30", counterparty="外卖", category_id=ledger.dining
            ),
        ],
    )
    late_refund, _, _, _, takeaway, takeaway_refund = rows
    assert match(client, late_refund, big["id"]).status_code == 200
    assert match(client, takeaway_refund, takeaway["id"]).status_code == 200

    def stats(**params) -> tuple[str, int]:
        body = listed(client, **params)["stats"]
        return body["net_amount"], body["count"]

    february = client.get(f"{API}/summary/months/2026-02").json()
    feb_leaves = leaves(client, "2026-02")
    assert feb_leaves[ledger.groceries] == ("225.00", 2)
    assert feb_leaves[ledger.dining] == ("0.00", 0)
    for category_id in (ledger.groceries, ledger.dining, ledger.metro):
        assert stats(month="2026-02", category_id=category_id) == feb_leaves[category_id]
    food = february["categories"][0]
    assert stats(month="2026-02", category_id=ledger.food) == (food["actual"], food["count"])
    for params in ({}, {"budget_account_id": ledger.daily}):
        assert stats(month="2026-02", **params) == (february["actual"], february["count"])
    assert (february["actual"], february["count"]) == ("229.00", 3)

    # The list keeps the ledger view: the March refund is a March row...
    march = listed(client, month="2026-03")
    assert [t["id"] for t in march["items"]] == [late_refund["id"]]
    # ...but counts in February, on the payment's channel.
    assert (march["stats"]["net_amount"], march["stats"]["count"]) == ("0.00", 0)
    assert stats(month="2026-02", channel_id=card) == ("150.00", 1)
    assert listed(client, month="2026-02", channel_id=card)["total"] == 1
    # A matched refund is listed under its effective category.
    groceries = listed(client, category_id=ledger.groceries)
    assert late_refund["id"] in [t["id"] for t in groceries["items"]]
    assert late_refund["id"] not in [
        t["id"] for t in listed(client, category_id=ledger.dining)["items"]
    ]

    # Months add up to the monthly series.
    series = client.get(f"{API}/summary/monthly", params={"from": "2026-02", "to": "2026-03"})
    actuals = [m["actual"] for m in series.json()["months"]]
    assert actuals == [
        february["actual"],
        client.get(f"{API}/summary/months/2026-03").json()["actual"],
    ]


def test_unfiltered_stats_include_annual_accounts(client, ledger):
    """Without a category or budget account filter, `stats` cover every row listed, so a
    month's stats are the month detail's `actual` plus `annual_actual`; filtered by a
    monthly or an annual budget account they split the same way."""
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    store(
        ledger,
        [
            ledger.item(date="2026-02-05", amount="80", counterparty="买菜"),
            ledger.item(
                date="2026-02-10", amount="600", counterparty="保险", category_id=insurance
            ),
        ],
    )
    february = client.get(f"{API}/summary/months/2026-02").json()
    assert (february["actual"], february["count"], february["annual_actual"]) == (
        "80.00",
        1,
        "600.00",
    )

    def stats(**params) -> tuple[str, int]:
        body = listed(client, month="2026-02", **params)["stats"]
        return body["net_amount"], body["count"]

    assert stats() == ("680.00", 2)
    assert stats(budget_account_id=ledger.daily) == (february["actual"], february["count"])
    assert stats(budget_account_id=yearly) == (february["annual_actual"], 1)


def test_unmatched_refund_filter(client, ledger):
    """AC8 (backend): only refunds without a payment are listed; their stats count none."""
    p, matched_refund, open1, open2 = store(
        ledger,
        [
            ledger.item(date="2026-09-01", amount="100", counterparty="P"),
            ledger.item(date="2026-09-02", amount="-10", counterparty="R"),
            ledger.item(date="2026-09-03", amount="-7", counterparty="O1"),
            ledger.item(date="2026-08-03", amount="-3", counterparty="O2"),
        ],
    )
    assert match(client, matched_refund, p["id"]).status_code == 200
    body = listed(client, refund_status="unmatched")
    assert [t["id"] for t in body["items"]] == [open1["id"], open2["id"]]
    assert body["total"] == 2
    assert body["stats"] == {"count": 0, "net_amount": "-10.00"}
    september = listed(client, refund_status="unmatched", month="2026-09")
    assert [t["id"] for t in september["items"]] == [open1["id"]]
    assert september["stats"] == {"count": 0, "net_amount": "-7.00"}
    assert_envelope(client.get(TX, params={"refund_status": "matched"}), 422, "VALIDATION_ERROR")

    assert match(client, open1, p["id"]).status_code == 200
    assert [t["id"] for t in listed(client, refund_status="unmatched")["items"]] == [open2["id"]]


def test_refund_candidates(client, ledger):
    """Candidates: dated on or before the refund, with enough left; same channel and
    counterparty first, then newest first; searchable; paged."""
    card = ledger.add_channel("信用卡")
    likely, _, partly_refunded, partly_refund, small, odd, after, refund = store(
        ledger,
        [
            ledger.item(date="2026-09-01", amount="100", counterparty="盒马"),
            ledger.item(date="2026-09-02", amount="1", counterparty="占位"),
            ledger.item(date="2026-09-03", amount="100", counterparty="盒马"),
            ledger.item(date="2026-09-04", amount="-80", counterparty="盒马"),
            ledger.item(date="2026-09-05", amount="20", counterparty="盒马"),
            ledger.item(
                date="2026-09-15", amount="50", counterparty="其他商户", description="满100%减"
            ),
            ledger.item(date="2026-09-25", amount="100", counterparty="盒马"),
            ledger.item(date="2026-09-20", amount="-30", counterparty=" 盒马 "),
        ],
    )
    other_channel = store(
        ledger, [ledger.item(date="2026-09-10", amount="100", counterparty="盒马")], channel_id=card
    )[0]
    assert match(client, partly_refund, partly_refunded["id"]).status_code == 200
    url = f"{TX}/{refund['id']}/refund-candidates"

    body = client.get(url).json()
    assert [t["id"] for t in body["items"]] == [likely["id"], odd["id"], other_channel["id"]]
    assert (body["total"], body["page"], body["page_size"]) == (3, 1, 20)
    for excluded in (partly_refunded, small, after):
        assert excluded["id"] not in [t["id"] for t in body["items"]]

    assert [t["id"] for t in client.get(url, params={"q": "其他"}).json()["items"]] == [odd["id"]]
    assert [t["id"] for t in client.get(url, params={"q": "%"}).json()["items"]] == [odd["id"]]
    page = client.get(url, params={"page": 2, "page_size": 1}).json()
    assert [t["id"] for t in page["items"]] == [odd["id"]] and page["total"] == 3

    # Its own current match does not use up the payment's room.
    assert match(client, refund, likely["id"]).status_code == 200
    again = client.get(url).json()["items"]
    assert again[0]["id"] == likely["id"] and again[0]["refunded"] == "30.00"

    assert_envelope(
        client.get(f"{TX}/{likely['id']}/refund-candidates"), 422, "INVALID_REFUND_TARGET"
    )
    assert_envelope(client.get(f"{TX}/999999/refund-candidates"), 404, "TRANSACTION_NOT_FOUND")


def test_annual_account_refund_across_years(client, ledger):
    """A January refund of a December payment of an annual account reduces December's
    year, not January's; fully refunded, the payment is no longer counted."""
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    paid, first, second = store(
        ledger,
        [
            ledger.item(
                date="2025-12-20", amount="6000", counterparty="保险", category_id=insurance
            ),
            ledger.item(
                date="2026-01-10", amount="-1000", counterparty="退保", category_id=insurance
            ),
            ledger.item(
                date="2026-01-11", amount="-5000", counterparty="退保2", category_id=insurance
            ),
        ],
    )

    def annual(month: str) -> tuple[str, int]:
        account = client.get(f"{API}/summary/annual/{month}").json()["accounts"][0]
        return account["actual"], account["count"]

    assert annual("2025-12") == ("6000.00", 1)
    assert annual("2026-01") == ("-6000.00", 0)
    assert match(client, first, paid["id"]).status_code == 200
    assert annual("2025-12") == ("5000.00", 1)
    assert annual("2026-01") == ("-5000.00", 0)
    assert match(client, second, paid["id"]).status_code == 200
    assert annual("2025-12") == ("0.00", 0)
    assert annual("2026-01") == ("0.00", 0)
    january = client.get(f"{API}/summary/monthly", params={"from": "2026-01", "to": "2026-01"})
    assert january.json()["months"][0]["annual_actual"] == "0.00"


def test_batch_refunds_name_their_payment(client, agent, ledger):
    """AC6: `refund_of_id` (a stored payment) and `refund_of_index` (a payment of the same
    batch) store matched refunds; an item without either is stored unmatched."""
    stored = store(ledger, [ledger.item(date="2026-09-01", amount="100", counterparty="盒马")])[0]
    response = ledger.submit(
        [
            ledger.item(
                date="2026-09-10", amount="-30", counterparty="盒马", refund_of_id=stored["id"]
            ),
            ledger.item(date="2026-09-11", amount="50", counterparty="同批"),
            ledger.item(
                date="2026-09-12",
                amount="-20",
                counterparty="同批",
                category_id=ledger.metro,
                refund_of_index=1,
            ),
            ledger.item(date="2026-09-12", amount="-5", counterparty="没找到"),
        ],
        client=agent,
    )
    assert response.status_code == 201, response.text
    refund, payment, same_batch, unmatched = response.json()["transactions"]
    assert refund["refund_of"]["id"] == stored["id"]
    assert same_batch["refund_of"]["id"] == payment["id"]
    assert same_batch["category_id"] == ledger.groceries  # the payment's
    assert payment["refunded"] == "20.00"
    assert unmatched["refund_of"] is None
    assert by_id(client, stored["id"])["refunded"] == "30.00"
    assert leaves(client, "2026-09")[ledger.groceries] == ("95.00", 2)

    # The refund's own (fallback) category is kept for when the match is removed.
    assert match(client, same_batch, None).json()["category_id"] == ledger.metro


def test_batch_refund_rejections_keep_the_batch_atomic(client, ledger):
    """AC6: per-item INVALID_REFUND_TARGET / REFUND_EXCEEDS_PAYMENT (refunds of one payment
    add up within the batch), INVALID_FIELD for both fields; nothing is written."""
    stored = store(ledger, [ledger.item(date="2026-09-01", amount="100", counterparty="S")])[0]
    earlier = store(ledger, [ledger.item(amount="-30", counterparty="S退")])[0]
    assert match(client, earlier, stored["id"]).status_code == 200

    def refund(name: str, amount: str = "-1", **extra) -> dict:
        return ledger.item(date="2026-09-12", amount=amount, counterparty=name, **extra)

    items = [
        ledger.item(date="2026-09-01", amount="10", counterparty="P0"),  # 0
        refund("R1", "-6", refund_of_index=0),  # 1 ok
        refund("R2", "-5", refund_of_index=0),  # 2 6 + 5 > 10
        refund("R3", refund_of_id=stored["id"], refund_of_index=0),  # 3 both
        refund("R4", refund_of_index=1),  # 4 points at a refund
        refund("R5", refund_of_index=5),  # 5 itself
        refund("R6", refund_of_index=99),  # 6 no such item
        ledger.item(amount="5", counterparty="P7", refund_of_id=stored["id"]),  # 7 a payment
        ledger.item(amount="5", counterparty="P8", category_id=424242),  # 8 rejected itself
        refund("R9", refund_of_index=8),  # 9 its payment is rejected
        refund("R10", refund_of_index=11),  # 10 payment dated after it
        ledger.item(date="2026-09-30", amount="5", counterparty="P11"),  # 11
        refund("R12", "-70.01", refund_of_id=stored["id"]),  # 12 70 left
        refund("R13", refund_of_id=999999),  # 13 no such payment
        refund("R14", refund_of_id=2**31),  # 14 no INTEGER holds it
    ]
    response = ledger.submit(items)
    body = assert_envelope(response, 409, "BATCH_REJECTED")
    feedback = body["details"]["items"]
    assert [entry.get("code") for entry in feedback] == [
        None,
        None,
        "REFUND_EXCEEDS_PAYMENT",
        "INVALID_FIELD",
        "INVALID_REFUND_TARGET",
        "INVALID_REFUND_TARGET",
        "INVALID_REFUND_TARGET",
        "INVALID_REFUND_TARGET",
        "CATEGORY_NOT_FOUND",
        "INVALID_REFUND_TARGET",
        "INVALID_REFUND_TARGET",
        None,
        "REFUND_EXCEEDS_PAYMENT",
        "INVALID_REFUND_TARGET",
        "INVALID_REFUND_TARGET",
    ]
    assert feedback[2]["refundable"] == "4.00" and feedback[2]["refund_of_index"] == 0
    assert (feedback[12]["refunded"], feedback[12]["refundable"]) == ("30.00", "70.00")
    assert "index=8" in feedback[9]["message"]
    assert feedback[3]["errors"][0]["reason"]
    assert ledger.count() == 2
    assert by_id(client, stored["id"])["refunded"] == "30.00"

    # Fixed up, the same batch goes through.
    items[2] = refund("R2", "-4", refund_of_index=0)
    items[12] = refund("R12", "-70", refund_of_id=stored["id"])
    accepted = ledger.submit([items[0], items[1], items[2], items[11], items[12]])
    assert accepted.status_code == 201, accepted.text
    assert by_id(client, stored["id"])["refunded"] == "100.00"


def test_payment_search(client, agent, ledger):
    """AC7 (REST): payments only, with what is refunded and refundable; filters; at most
    366 days and 50 results."""
    card = ledger.add_channel("信用卡")
    old, paid, refund, _ = store(
        ledger,
        [
            ledger.item(date="2025-09-01", amount="9", counterparty="去年"),
            ledger.item(date="2026-09-01", amount="100", counterparty="盒马"),
            ledger.item(date="2026-09-02", amount="-30", counterparty="盒马"),
            ledger.item(date="2026-09-04", amount="-5", counterparty="盒马"),
        ],
    )
    fresh = store(
        ledger,
        [ledger.item(date="2026-09-03", amount="40", counterparty="盒马Fresh")],
        channel_id=card,
    )[0]
    assert match(client, refund, paid["id"]).status_code == 200
    url = f"{API}/payments/search"
    september = {"date_from": "2026-09-01", "date_to": "2026-09-30"}

    payments = agent.get(url, params=september).json()["payments"]
    assert [p["id"] for p in payments] == [fresh["id"], paid["id"]]
    assert payments[1] == {
        "id": paid["id"],
        "channel_id": ledger.channel,
        "channel_name": "储蓄卡",
        "date": "2026-09-01",
        "amount": "100.00",
        "counterparty": "盒马",
        "description": "支付宝消费",
        "category_id": ledger.groceries,
        "category_name": "买菜",
        "refunded": "30.00",
        "refundable": "70.00",
    }

    def ids(**params) -> list[int]:
        response = agent.get(url, params={**september, **params})
        assert response.status_code == 200, response.text
        return [p["id"] for p in response.json()["payments"]]

    assert ids(counterparty="盒马FRESH") == [fresh["id"]]
    assert ids(channel_id=ledger.channel) == [paid["id"]]
    assert ids(limit=1) == [fresh["id"]]
    assert ids(date_from="2025-09-01", date_to="2026-09-01") == [paid["id"], old["id"]]

    for params, code in (
        ({"limit": 0}, "INVALID_LIMIT"),
        ({"limit": 51}, "INVALID_LIMIT"),
        ({"date_from": "2026-09-02", "date_to": "2026-09-01"}, "INVALID_DATE_RANGE"),
        ({"date_from": "2025-09-01", "date_to": "2026-09-02"}, "INVALID_DATE_RANGE"),
        ({"channel_id": 999}, "CHANNEL_NOT_FOUND"),
        ({"date_from": "2026-02-30"}, "VALIDATION_ERROR"),
    ):
        assert_envelope(agent.get(url, params={**september, **params}), 422, code)
