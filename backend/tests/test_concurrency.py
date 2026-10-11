"""The duplicate check holds when overlapping batches are submitted at the same time."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.db import get_engine
from app.services.transactions import compute_fingerprint

ROUNDS = 8
WORKERS = 4


def test_concurrent_overlapping_batches_store_the_shared_item_once(app, client, ledger):
    """Each round, several batches that all contain one shared item race each other.
    Exactly one may be stored; the others must be rejected in full."""
    cookies = dict(client.cookies)

    def submit(barrier: threading.Barrier, items: list[dict]):
        http = TestClient(app, cookies=cookies)
        barrier.wait(timeout=10)
        return http.post(ledger.batch_url(), json={"items": items})

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for round_number in range(ROUNDS):
            shared = ledger.item(counterparty=f"共享商户{round_number}")
            barrier = threading.Barrier(WORKERS)
            futures = [
                pool.submit(
                    submit,
                    barrier,
                    [ledger.item(counterparty=f"独有{round_number}-{worker}"), shared],
                )
                for worker in range(WORKERS)
            ]
            responses = [future.result(timeout=30) for future in futures]

            statuses = sorted(response.status_code for response in responses)
            assert statuses == [201] + [409] * (WORKERS - 1), statuses
            for response in responses:
                if response.status_code == 409:
                    feedback = response.json()["details"]["items"]
                    assert feedback[0] == {"index": 0, "status": "ok"}
                    assert feedback[1]["code"] == "SUSPECTED_DUPLICATE"
                    assert feedback[1]["existing"]["counterparty"] == shared["counterparty"]

    with get_engine().connect() as connection:
        per_counterparty = connection.execute(
            text("SELECT counterparty, count(*) FROM transactions GROUP BY counterparty")
        ).all()
    counts = dict(per_counterparty)
    assert all(count == 1 for count in counts.values()), counts
    # Per round: the shared item once, plus the winner's own item. Losers left nothing.
    assert len(counts) == ROUNDS * 2


def test_batch_waits_for_the_channel_lock_then_sees_the_committed_duplicate(app, client, ledger):
    """Deterministic version: while another transaction holds the channel's advisory
    lock, a batch neither checks nor inserts. Once that transaction commits a row
    with the same fingerprint, the batch sees it and is rejected."""
    item = ledger.item(counterparty="并发商户")
    fingerprint = compute_fingerprint(
        ledger.channel, date(2026, 9, 15), Decimal("35.50"), "并发商户", item["description"]
    )
    result = {}

    def submit() -> None:
        result["response"] = ledger.submit(
            [item], client=TestClient(app, cookies=dict(client.cookies))
        )

    with get_engine().connect() as holder:
        holder.execute(
            text("SELECT pg_advisory_xact_lock(1002, :channel_id)"),
            {"channel_id": ledger.channel},
        )
        worker = threading.Thread(target=submit)
        worker.start()
        time.sleep(1.0)
        assert worker.is_alive(), "the batch must wait for the channel lock"

        holder.execute(
            text(
                "INSERT INTO transactions (channel_id, category_id, date, amount, counterparty,"
                " description, fingerprint) VALUES (:channel_id, :category_id, '2026-09-15',"
                " 35.50, '并发商户', :description, :fingerprint)"
            ),
            {
                "channel_id": ledger.channel,
                "category_id": ledger.groceries,
                "description": item["description"],
                "fingerprint": fingerprint,
            },
        )
        holder.commit()  # releases the lock
        worker.join(timeout=30)

    response = result["response"]
    assert response.status_code == 409
    assert response.json()["details"]["items"][0]["code"] == "SUSPECTED_DUPLICATE"
    assert ledger.count() == 1

    # A different channel's lock does not block this channel.
    with get_engine().connect() as holder:
        holder.execute(text("SELECT pg_advisory_xact_lock(1002, :id)"), {"id": ledger.channel + 1})
        assert ledger.submit([ledger.item(counterparty="不受影响")]).status_code == 201
        holder.rollback()
