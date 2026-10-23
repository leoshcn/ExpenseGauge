"""Deleting transactions so the delete can be undone.

A deleted row is copied, every column, into `deleted_transactions` under its own id, in
the same database transaction as the delete. `restore` inserts it again with that id, so
everything that pointed at it (a refund's `refund_of_id`, the user's links) is valid
again, and the figures are exactly as before. Rows are kept for `KEEP` and purged on the
next delete. The sequence of `transactions.id` is never advanced or reused.
"""

from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import AppError, conflict
from app.models import ApiToken, Category, DeletedTransaction, PaymentChannel, Transaction
from app.schemas.transaction import RestoreOut
from app.services.refunds import (
    RefundTargetFacts,
    lock_transactions,
    refund_match_error,
    refunded_amounts,
)

KEEP = timedelta(days=7)
ZERO = Decimal("0.00")


def snapshot(transaction: Transaction) -> dict[str, Any]:
    """Every column but `id`, as JSON."""
    return {
        "channel_id": transaction.channel_id,
        "category_id": transaction.category_id,
        "date": transaction.date.isoformat(),
        "amount": f"{transaction.amount:.2f}",
        "counterparty": transaction.counterparty,
        "description": transaction.description,
        "note": transaction.note,
        "fingerprint": transaction.fingerprint,
        "confirmed_duplicate": transaction.confirmed_duplicate,
        "api_token_id": transaction.api_token_id,
        "refund_of_id": transaction.refund_of_id,
        "created_at": transaction.created_at.isoformat(),
    }


def trash(db: Session, rows: list[Transaction]) -> None:
    """Deletes `rows` (refunds before payments) and keeps a copy of each; drops copies
    older than `KEEP`. The caller has locked the rows and commits."""
    db.execute(
        delete(DeletedTransaction).where(DeletedTransaction.deleted_at < datetime.now(UTC) - KEEP)
    )
    for row in sorted(rows, key=lambda row: (row.amount > 0, row.id)):
        db.execute(delete(DeletedTransaction).where(DeletedTransaction.id == row.id))
        db.add(DeletedTransaction(id=row.id, data=snapshot(row)))
        db.delete(row)
        db.flush()


def bulk_delete(db: Session, ids: list[int]) -> None:
    """Deletes every transaction of `ids` or none. 404 `TRANSACTION_NOT_FOUND` if one is
    missing; 409 `TRANSACTION_HAS_REFUNDS` if a payment has matched refunds that are not
    deleted with it."""
    wanted = set(ids)
    locked = lock_transactions(db, wanted)
    missing = sorted(wanted - locked.keys())
    if missing:
        db.rollback()
        raise AppError(
            404, "TRANSACTION_NOT_FOUND", f"流水不存在：{missing}", {"missing_ids": missing}
        )
    payment_ids = [row.id for row in locked.values() if row.amount > 0]
    refund_ids = sorted(
        db.scalars(
            select(Transaction.id).where(
                Transaction.refund_of_id.in_(payment_ids), Transaction.id.not_in(wanted)
            )
        )
    )
    if refund_ids:
        db.rollback()
        raise conflict(
            "TRANSACTION_HAS_REFUNDS",
            f"所选支付已匹配 {len(refund_ids)} 笔未一起删除的退款，请一并选中或先取消匹配",
            {"refund_ids": refund_ids},
        )
    trash(db, list(locked.values()))
    db.commit()


def _refusal(transaction_id: int, reason: str, message: str) -> dict[str, Any]:
    return {"id": transaction_id, "reason": reason, "message": message}


def restore(db: Session, ids: list[int]) -> RestoreOut:
    """Puts deleted transactions back under their own ids, every one or none. 409
    `RESTORE_CONFLICT` with `details.items` (one `{id, reason, message}` per refused id)
    when a copy is gone (`TRASH_EXPIRED`), the id is taken (`ID_TAKEN`), its channel or
    category was deleted (`CHANNEL_GONE`, `CATEGORY_GONE`), or a refund's payment is gone
    or cannot take it back (`REFUND_TARGET_GONE`, or the `refund_match_error` code)."""
    from app.services.transactions import describe

    wanted = sorted(set(ids))
    copies = {
        row.id: row
        for row in db.scalars(
            select(DeletedTransaction).where(DeletedTransaction.id.in_(wanted)).with_for_update()
        )
    }
    refusals: list[dict[str, Any]] = []
    rows: list[Transaction] = []
    for transaction_id in wanted:
        copy = copies.get(transaction_id)
        if copy is None:
            refusals.append(
                _refusal(transaction_id, "TRASH_EXPIRED", "已超过可撤销的时间，无法恢复")
            )
            continue
        data = copy.data
        if get_by_id(db, Transaction, transaction_id) is not None:
            refusals.append(_refusal(transaction_id, "ID_TAKEN", "这笔流水已经存在"))
            continue
        if get_by_id(db, PaymentChannel, data["channel_id"]) is None:
            refusals.append(_refusal(transaction_id, "CHANNEL_GONE", "付款渠道已不存在"))
            continue
        category = get_by_id(db, Category, data["category_id"])
        if category is None or category.parent_id is None:
            refusals.append(_refusal(transaction_id, "CATEGORY_GONE", "分类已不存在"))
            continue
        token_id = data["api_token_id"]
        rows.append(
            Transaction(
                id=transaction_id,
                channel_id=data["channel_id"],
                category_id=data["category_id"],
                date=date.fromisoformat(data["date"]),
                amount=Decimal(data["amount"]),
                counterparty=data["counterparty"],
                description=data["description"],
                note=data["note"],
                fingerprint=data["fingerprint"],
                confirmed_duplicate=data["confirmed_duplicate"],
                api_token_id=token_id
                if token_id is not None and get_by_id(db, ApiToken, token_id) is not None
                else None,
                refund_of_id=data["refund_of_id"],
                created_at=datetime.fromisoformat(data["created_at"]),
            )
        )
    if refusals:
        db.rollback()
        raise _restore_conflict(refusals)

    # Payments first, so a refund deleted together with its payment finds it again.
    for row in sorted(rows, key=lambda row: (row.amount < 0, row.id)):
        if row.refund_of_id is not None:
            target = lock_transactions(db, {row.refund_of_id}).get(row.refund_of_id)
            if target is None:
                refusals.append(
                    _refusal(row.id, "REFUND_TARGET_GONE", "这笔退款对应的原支付已被删除")
                )
                continue
            already = refunded_amounts(db, {target.id}).get(target.id, ZERO)
            error = refund_match_error(
                row.amount,
                row.date,
                RefundTargetFacts(target.amount, target.date, already),
                {"refund_of_id": target.id},
            )
            if error is not None:
                refusals.append(_refusal(row.id, error.code, error.message))
                continue
        db.add(row)
        db.flush()
    if refusals:
        db.rollback()
        raise _restore_conflict(refusals)

    db.execute(delete(DeletedTransaction).where(DeletedTransaction.id.in_(wanted)))
    db.flush()
    result = RestoreOut(transactions=describe(db, rows))
    db.commit()
    return result


def _restore_conflict(refusals: list[dict[str, Any]]) -> AppError:
    first = refusals[0]["message"]
    more = f"等 {len(refusals)} 笔" if len(refusals) > 1 else ""
    return conflict("RESTORE_CONFLICT", f"无法撤销删除{more}：{first}", {"items": refusals})
