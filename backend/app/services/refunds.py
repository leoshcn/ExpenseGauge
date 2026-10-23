"""Refund matching: where a transaction counts, and when a refund may point at a payment.

A refund (`amount < 0`) may point at the payment (`amount > 0`) it reverses through
`refund_of_id`. Its **effective attribution** is then the payment's: date, category and
channel. A payment and an unmatched refund count as themselves. Every figure that adds
transactions up (the three summaries, the transaction list's `stats`) goes through
`effective_totals`, so they cannot disagree.

A payment's net amount is its amount plus its matched refunds; it is a "consumption"
(counted) while that is above zero.
"""

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import ColumnElement, Date, Select, Subquery, case, cast, func, select
from sqlalchemy.orm import Session, aliased

from app.db import MAX_ID
from app.errors import AppError, invalid
from app.models import Transaction

ZERO = Decimal("0.00")

# FROM transactions LEFT JOIN transactions AS payment ON payment.id = transactions.refund_of_id
payment = aliased(Transaction, name="payment")
effective_date = func.coalesce(payment.date, Transaction.date)
effective_category = func.coalesce(payment.category_id, Transaction.category_id)
effective_channel = func.coalesce(payment.channel_id, Transaction.channel_id)
# A matched refund's note is its payment's (which may be NULL), for tags.
effective_note = case((Transaction.refund_of_id.is_not(None), payment.note), else_=Transaction.note)


def join_payment(statement: Select) -> Select:
    """Adds the join the `effective_*` expressions need."""
    return statement.select_from(Transaction).outerjoin(
        payment, payment.id == Transaction.refund_of_id
    )


def refunded_subquery(exclude_refund_id: int | None = None) -> Subquery:
    """`(payment_id, refunded)`: the (negative) sum of the refunds matched to a payment."""
    refund = aliased(Transaction, name="refund")
    conditions = [refund.refund_of_id.is_not(None)]
    if exclude_refund_id is not None:
        conditions.append(refund.id != exclude_refund_id)
    return (
        select(
            refund.refund_of_id.label("payment_id"),
            func.sum(refund.amount).label("refunded"),
        )
        .where(*conditions)
        .group_by(refund.refund_of_id)
        .subquery("refunded")
    )


@dataclass(frozen=True)
class Totals:
    amount: Decimal = ZERO
    count: int = 0


NO_TOTALS = Totals()


def effective_totals(
    db: Session,
    *,
    category_ids: list[int] | None = None,
    start: date | None = None,
    end: date | None = None,
    channel_id: int | None = None,
    unmatched_refunds_only: bool = False,
    extra_conditions: Sequence[ColumnElement[bool]] = (),
) -> dict[tuple[date, int], Totals]:
    """Net amount and consumption count per (first day of month, level-2 category), by
    effective attribution. `start` is inclusive and `end` exclusive; a filter left None
    does not restrict. With `unmatched_refunds_only` only those refunds are added up, and
    nothing is counted (a refund is never a consumption). `extra_conditions` (the
    transaction list's text, amount and tag filters) must use only `Transaction`'s own
    columns: they apply to every row added up and to the payments counted."""
    month = cast(func.date_trunc("month", effective_date), Date)
    conditions = []
    if category_ids is not None:
        conditions.append(effective_category.in_(category_ids))
    if start is not None:
        conditions.append(effective_date >= start)
    if end is not None:
        conditions.append(effective_date < end)
    if channel_id is not None:
        conditions.append(effective_channel == channel_id)
    if unmatched_refunds_only:
        conditions += [Transaction.amount < 0, Transaction.refund_of_id.is_(None)]
    conditions += extra_conditions
    amounts = db.execute(
        join_payment(select(month, effective_category, func.sum(Transaction.amount)))
        .where(*conditions)
        .group_by(month, effective_category)
    ).all()
    totals = {
        (month_start, category_id): Totals(amount) for month_start, category_id, amount in amounts
    }
    if unmatched_refunds_only:
        return totals

    # A payment's effective attribution is its own, so the same filters apply to its columns.
    refunded = refunded_subquery()
    own_month = cast(func.date_trunc("month", Transaction.date), Date)
    conditions = [
        Transaction.amount > 0,
        Transaction.amount + func.coalesce(refunded.c.refunded, 0) > 0,
    ]
    if category_ids is not None:
        conditions.append(Transaction.category_id.in_(category_ids))
    if start is not None:
        conditions.append(Transaction.date >= start)
    if end is not None:
        conditions.append(Transaction.date < end)
    if channel_id is not None:
        conditions.append(Transaction.channel_id == channel_id)
    conditions += extra_conditions
    counts = db.execute(
        select(own_month, Transaction.category_id, func.count())
        .select_from(Transaction)
        .outerjoin(refunded, refunded.c.payment_id == Transaction.id)
        .where(*conditions)
        .group_by(own_month, Transaction.category_id)
    ).all()
    for month_start, category_id, count in counts:
        key = (month_start, category_id)
        totals[key] = Totals(totals.get(key, NO_TOTALS).amount, count)
    return totals


def sum_totals(totals: list[Totals]) -> Totals:
    return Totals(sum((t.amount for t in totals), ZERO), sum(t.count for t in totals))


def refunded_amounts(
    db: Session, payment_ids: set[int], exclude_refund_id: int | None = None
) -> dict[int, Decimal]:
    """The matched refunds of each payment as a positive total; payments without any are
    absent. `exclude_refund_id` leaves one refund out (the one being re-matched)."""
    if not payment_ids:
        return {}
    refunded = refunded_subquery(exclude_refund_id)
    rows = db.execute(
        select(refunded.c.payment_id, refunded.c.refunded).where(
            refunded.c.payment_id.in_(payment_ids)
        )
    )
    return {payment_id: -total for payment_id, total in rows}


def lock_transactions(db: Session, ids: set[int]) -> dict[int, Transaction]:
    """`SELECT ... FOR UPDATE` on the rows that exist, in id order (so two requests that
    lock several rows cannot deadlock). Until commit nobody else can match a refund to
    them or delete them: read a payment's matched total only after this."""
    storable = sorted(row_id for row_id in ids if 0 < row_id <= MAX_ID)
    if not storable:
        return {}
    rows = db.scalars(
        select(Transaction)
        .where(Transaction.id.in_(storable))
        .order_by(Transaction.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return {row.id: row for row in rows}


@dataclass(frozen=True)
class RefundTargetFacts:
    """What the rules need to know about the transaction a refund points at."""

    amount: Decimal
    date: date
    refunded: Decimal  # already matched to it (positive), without the refund being checked


def refund_match_error(
    refund_amount: Decimal,
    refund_date: date,
    target: RefundTargetFacts | None,
    reference: dict[str, Any],
) -> AppError | None:
    """The reason a refund may not be matched to `target`, or None when it may.
    `reference` names the target in the error details (`refund_of_id` / `refund_of_index`)."""
    if refund_amount >= 0:
        return invalid("INVALID_REFUND_TARGET", "只有退款（金额为负）可以匹配原支付", reference)
    if target is None:
        return invalid("INVALID_REFUND_TARGET", "要匹配的原支付不存在", reference)
    if target.amount <= 0:
        return invalid(
            "INVALID_REFUND_TARGET", "匹配目标必须是一笔支付（金额为正），不能是退款", reference
        )
    if target.date > refund_date:
        return invalid(
            "INVALID_REFUND_TARGET",
            f"原支付的日期（{target.date.isoformat()}）不能晚于退款日期"
            f"（{refund_date.isoformat()}）",
            reference,
        )
    refundable = target.amount - target.refunded
    if -refund_amount > refundable:
        return invalid(
            "REFUND_EXCEEDS_PAYMENT",
            f"退款合计超过原支付金额：原支付 {target.amount:.2f}，已退 {target.refunded:.2f}，"
            f"还可退 {refundable:.2f}",
            {
                **reference,
                "payment_amount": f"{target.amount:.2f}",
                "refunded": f"{target.refunded:.2f}",
                "refundable": f"{refundable:.2f}",
            },
        )
    return None
