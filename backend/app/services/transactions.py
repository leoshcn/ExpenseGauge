"""Transactions: all-or-nothing batch submission with per-item feedback, list, edit, delete,
an agent's category changes, and refund matching (see `services/refunds.py` for the rules
and the attribution).

A batch comes from one payment channel. Categories are the global tree; a transaction's
budget account is its category's, never stored on the transaction.
"""

import hashlib
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any, Literal

from pydantic import ValidationError
from sqlalchemy import and_, case, func, literal, or_, select
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import AppError, conflict, invalid, not_found
from app.models import BudgetAccount, Category, Transaction
from app.months import add_months, parse_month
from app.schemas.category import CategoryLeaf
from app.schemas.transaction import (
    MAX_BATCH_ITEMS,
    MAX_NOTE_LENGTH,
    MAX_PAYMENT_SEARCH_DAYS,
    MAX_PAYMENT_SEARCH_LIMIT,
    MAX_RECATEGORIZE_ITEMS,
    BatchAcceptedOut,
    PaymentOut,
    PaymentSearchOut,
    RecategorizeAcceptedOut,
    RecategorizeItemIn,
    RefundCandidatePage,
    RefundTarget,
    TransactionItemIn,
    TransactionKind,
    TransactionOut,
    TransactionPage,
    TransactionSearchOut,
    TransactionStats,
    TransactionUpdateIn,
)
from app.services.budget_accounts import budget_accounts_by_id, get_budget_account
from app.services.categories import build_nodes, load_categories
from app.services.channels import channel_names, get_channel
from app.services.locks import lock_channel_transactions
from app.services.refunds import (
    RefundTargetFacts,
    effective_category,
    effective_totals,
    join_payment,
    lock_transactions,
    refund_match_error,
    refunded_amounts,
    refunded_subquery,
    sum_totals,
)

_WHITESPACE = re.compile(r"\s+")
CENT = Decimal("0.01")
ZERO = Decimal("0.00")

DUPLICATE_HINT = "与用户确认后，带 confirm_duplicate=true 重新提交该条"

RefundStatus = Literal["unmatched"]


def normalize_text(value: str) -> str:
    """NFKC, trim, collapse whitespace, casefold."""
    return _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip().casefold()


def compute_fingerprint(
    channel_id: int, day: date, amount: Decimal, counterparty: str, description: str
) -> str:
    """Duplicates are looked for within one payment channel only: the same purchase seen
    on two channels (e.g. a card and the wallet that charged it) is two records."""
    parts = [
        str(channel_id),
        day.isoformat(),
        f"{amount:.2f}",
        normalize_text(counterparty),
        normalize_text(description),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


@dataclass(frozen=True)
class _Names:
    """What a `TransactionOut` needs besides the row: categories and display names."""

    categories: dict[int, Category]
    channels: dict[int, str]
    budget_accounts: dict[int, BudgetAccount]


def _load_names(db: Session) -> _Names:
    return _Names(
        categories={c.id: c for c in load_categories(db)},
        channels=channel_names(db),
        budget_accounts=budget_accounts_by_id(db),
    )


def to_out(
    transaction: Transaction,
    names: _Names,
    payment: Transaction | None = None,
    refunded: Decimal = ZERO,
) -> TransactionOut:
    """`payment` is the payment a matched refund points at: its category is the one the
    refund counts in, so that is the category shown. `refunded` is a payment's matched
    refunds (positive)."""
    category = names.categories[(payment or transaction).category_id]
    parent = names.categories[category.parent_id]
    refund_of = None
    if payment is not None:
        refund_of = RefundTarget(
            id=payment.id,
            date=payment.date,
            amount=payment.amount,
            counterparty=payment.counterparty,
            category_name=category.name,
        )
    return TransactionOut(
        id=transaction.id,
        channel_id=transaction.channel_id,
        channel_name=names.channels[transaction.channel_id],
        category_id=category.id,
        category_name=category.name,
        parent_category_id=parent.id,
        parent_category_name=parent.name,
        budget_account_id=category.budget_account_id,
        budget_account_name=names.budget_accounts[category.budget_account_id].name,
        date=transaction.date,
        amount=transaction.amount,
        counterparty=transaction.counterparty,
        description=transaction.description,
        note=transaction.note,
        confirmed_duplicate=transaction.confirmed_duplicate,
        refund_of=refund_of,
        refunded=refunded.quantize(CENT),
        created_at=transaction.created_at,
    )


def _outputs(db: Session, rows: list[Transaction], names: _Names) -> list[TransactionOut]:
    """`to_out` for several rows, with their payments and refunded totals loaded at once."""
    payment_ids = {row.refund_of_id for row in rows if row.refund_of_id is not None}
    payments: dict[int, Transaction] = {}
    if payment_ids:
        payments = {
            row.id: row
            for row in db.scalars(select(Transaction).where(Transaction.id.in_(payment_ids)))
        }
    refunded = refunded_amounts(db, {row.id for row in rows if row.amount > 0})
    return [
        to_out(
            row,
            names,
            payments.get(row.refund_of_id) if row.refund_of_id is not None else None,
            refunded.get(row.id, ZERO),
        )
        for row in rows
    ]


def _rejected(index: int, code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"index": index, "status": "rejected", "code": code, "message": message, **extra}


def _rejected_by(index: int, error: AppError) -> dict[str, Any]:
    return _rejected(index, error.code, error.message, **error.details)


def _field_errors(exc: ValidationError) -> list[dict[str, str]]:
    return [
        {"field": ".".join(str(part) for part in error["loc"]) or "item", "reason": error["msg"]}
        for error in exc.errors()
    ]


def _invalid_field(index: int, exc: ValidationError) -> dict[str, Any]:
    errors = _field_errors(exc)
    fields = "、".join(sorted({error["field"] for error in errors}))
    return _rejected(index, "INVALID_FIELD", f"字段无效：{fields}", errors=errors)


@dataclass(frozen=True)
class _CategoryChoices:
    """What a `CATEGORY_NOT_FOUND` / `CATEGORY_NOT_LEAF` item carries to help the agent."""

    valid_categories: list[dict[str, Any]]
    children_of: dict[int, list[CategoryLeaf]]


def _category_choices(names: _Names) -> _CategoryChoices:
    nodes = build_nodes(list(names.categories.values()), names.budget_accounts)
    return _CategoryChoices(
        valid_categories=[node.model_dump(mode="json") for node in nodes],
        children_of={node.id: node.children for node in nodes},
    )


def _category_rejection(
    index: int, category_id: int, names: _Names, choices: _CategoryChoices
) -> dict[str, Any] | None:
    """The rejection of an item whose category is not a level-2 category, or None."""
    category = names.categories.get(category_id)
    if category is None:
        return _rejected(
            index,
            "CATEGORY_NOT_FOUND",
            f"分类 {category_id} 不存在，请从 valid_categories 的二级分类中选择",
            valid_categories=choices.valid_categories,
        )
    if category.parent_id is None:
        children = choices.children_of[category.id]
        return _rejected(
            index,
            "CATEGORY_NOT_LEAF",
            f"“{category.name}”是一级分类，流水只能归入其下的二级分类",
            parent={"id": category.id, "name": category.name},
            children=[child.model_dump(mode="json") for child in children],
        )
    return None


def _raise_if_rejected(db: Session, feedback: list[dict[str, Any] | None]) -> None:
    """`BATCH_REJECTED` (409) carrying every item's feedback when any item is rejected."""
    rejected_count = sum(1 for entry in feedback if entry and entry["status"] == "rejected")
    if rejected_count:
        db.rollback()  # releases the advisory lock and the row locks; nothing was written
        raise AppError(
            409,
            "BATCH_REJECTED",
            f"本批共 {len(feedback)} 条，其中 {rejected_count} 条被拒绝，未写入任何数据",
            {"items": feedback},
        )


def _check_batch_refunds(
    db: Session,
    parsed: dict[int, tuple[TransactionItemIn, str]],
    feedback: list[dict[str, Any] | None],
) -> None:
    """Refund matching of a batch, after every other check. Writes a rejection into
    `feedback` for each item whose match is not allowed. Stored targets are locked
    (`FOR UPDATE`) until the batch's commit or rollback. Several refunds of the batch that
    point at one payment are added up."""

    def ok(index: int) -> bool:
        entry = feedback[index]
        return entry is not None and entry["status"] == "ok"

    matching = [
        index
        for index in sorted(parsed)
        if ok(index)
        and (
            parsed[index][0].refund_of_id is not None
            or parsed[index][0].refund_of_index is not None
        )
    ]
    if not matching:
        return
    # Only a refund may point at a payment. Rejected first, so that a payment carrying a
    # reference is not then used as some refund's target.
    refunds: list[int] = []
    for index in matching:
        item = parsed[index][0]
        if item.amount > 0:
            reference = (
                {"refund_of_id": item.refund_of_id}
                if item.refund_of_id is not None
                else {"refund_of_index": item.refund_of_index}
            )
            feedback[index] = _rejected_by(
                index, refund_match_error(item.amount, item.date, None, reference)
            )
        else:
            refunds.append(index)

    stored_ids = {
        item.refund_of_id
        for item, _ in (parsed[i] for i in refunds)
        if item.refund_of_id is not None
    }
    stored = lock_transactions(db, stored_ids)
    already = refunded_amounts(db, set(stored))
    # Refunded so far, per stored payment id or per batch index.
    added: dict[tuple[str, int], Decimal] = {}

    for index in refunds:
        item = parsed[index][0]
        target: RefundTargetFacts | None = None
        if item.refund_of_id is not None:
            key = ("id", item.refund_of_id)
            reference: dict[str, Any] = {"refund_of_id": item.refund_of_id}
            row = stored.get(item.refund_of_id)
            if row is not None:
                target = RefundTargetFacts(
                    row.amount, row.date, already.get(row.id, ZERO) + added.get(key, ZERO)
                )
        else:
            target_index = item.refund_of_index
            key = ("index", target_index)
            reference = {"refund_of_index": target_index}
            if target_index == index or target_index not in range(len(feedback)):
                feedback[index] = _rejected(
                    index,
                    "INVALID_REFUND_TARGET",
                    f"refund_of_index={target_index} 不是本批中的另一条",
                    **reference,
                )
                continue
            if not ok(target_index):
                feedback[index] = _rejected(
                    index,
                    "INVALID_REFUND_TARGET",
                    f"要匹配的第 {target_index} 条（index={target_index}）本身被拒绝，请先处理该条",
                    **reference,
                )
                continue
            target_item = parsed[target_index][0]
            target = RefundTargetFacts(
                target_item.amount.quantize(CENT), target_item.date, added.get(key, ZERO)
            )
        error = refund_match_error(item.amount, item.date, target, reference)
        if error is not None:
            feedback[index] = _rejected_by(index, error)
            continue
        added[key] = added.get(key, ZERO) - item.amount.quantize(CENT)


def submit_batch(
    db: Session, channel_id: int, raw_items: list[Any], api_token_id: int | None = None
) -> BatchAcceptedOut:
    """Stores every item or none.

    Raises `BATCH_REJECTED` (409) carrying one feedback entry per item when any item is
    rejected. Validation and insert share one database transaction that holds the
    channel's advisory lock, so concurrent batches cannot both pass the duplicate check,
    and the row locks of the stored payments refunds are matched to.
    """
    get_channel(db, channel_id)
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= MAX_BATCH_ITEMS:
        raise invalid(
            "INVALID_BATCH_SIZE",
            f"每批需包含 1 到 {MAX_BATCH_ITEMS} 条流水",
            {"max_items": MAX_BATCH_ITEMS},
        )

    lock_channel_transactions(db, channel_id)

    names = _load_names(db)
    choices = _category_choices(names)

    feedback: list[dict[str, Any] | None] = [None] * len(raw_items)
    parsed: dict[int, tuple[TransactionItemIn, str]] = {}

    for index, raw in enumerate(raw_items):
        try:
            item = TransactionItemIn.model_validate(raw)
        except ValidationError as exc:
            feedback[index] = _invalid_field(index, exc)
            continue
        rejection = _category_rejection(index, item.category_id, names, choices)
        if rejection is not None:
            feedback[index] = rejection
            continue
        fingerprint = compute_fingerprint(
            channel_id, item.date, item.amount, item.counterparty, item.description
        )
        parsed[index] = (item, fingerprint)

    existing_by_fingerprint: dict[str, Transaction] = {}
    fingerprints = {fingerprint for _, fingerprint in parsed.values()}
    if fingerprints:
        rows = db.scalars(
            select(Transaction)
            .where(Transaction.channel_id == channel_id, Transaction.fingerprint.in_(fingerprints))
            .order_by(Transaction.id.desc())
        )
        for row in rows:  # descending, so the earliest stored match wins
            existing_by_fingerprint[row.fingerprint] = row

    first_index_in_batch: dict[str, int] = {}
    duplicates: dict[int, bool] = {}
    for index in sorted(parsed):
        item, fingerprint = parsed[index]
        existing = existing_by_fingerprint.get(fingerprint)
        earlier_index = first_index_in_batch.get(fingerprint)
        first_index_in_batch.setdefault(fingerprint, index)
        is_duplicate = existing is not None or earlier_index is not None
        if is_duplicate and not item.confirm_duplicate:
            if existing is not None:
                feedback[index] = _rejected(
                    index,
                    "SUSPECTED_DUPLICATE",
                    f"疑似重复：该渠道已有一条 {existing.date.isoformat()} "
                    f"{existing.counterparty} {existing.amount:.2f} 的流水",
                    existing=_outputs(db, [existing], names)[0].model_dump(mode="json"),
                    hint=DUPLICATE_HINT,
                )
            else:
                feedback[index] = _rejected(
                    index,
                    "DUPLICATE_IN_BATCH",
                    f"与本批第 {earlier_index} 条（index={earlier_index}）内容相同",
                    duplicate_of_index=earlier_index,
                    hint=DUPLICATE_HINT,
                )
            continue
        feedback[index] = {"index": index, "status": "ok"}
        duplicates[index] = is_duplicate

    _check_batch_refunds(db, parsed, feedback)

    _raise_if_rejected(db, feedback)

    inserted: dict[int, Transaction] = {}
    for index in sorted(parsed):
        item, fingerprint = parsed[index]
        inserted[index] = Transaction(
            channel_id=channel_id,
            category_id=item.category_id,
            date=item.date,
            amount=item.amount.quantize(CENT),  # as NUMERIC(14,2) stores it
            counterparty=item.counterparty,
            description=item.description,
            note=item.note,
            fingerprint=fingerprint,
            # The flag only means something when there was a match; otherwise it is ignored.
            confirmed_duplicate=duplicates[index],
            refund_of_id=item.refund_of_id,
            api_token_id=api_token_id,
        )
    to_insert = list(inserted.values())
    db.add_all(to_insert)
    db.flush()
    # A payment of the same batch has an id only now.
    for index, row in inserted.items():
        target_index = parsed[index][0].refund_of_index
        if target_index is not None:
            row.refund_of_id = inserted[target_index].id
    db.flush()
    result = BatchAcceptedOut(transactions=_outputs(db, to_insert, names))
    db.commit()
    return result


def _leaf_ids(categories: dict[int, Category], category_id: int) -> list[int]:
    """The level-2 ids a `category_id` filter means: itself, or a level-1's children."""
    category = categories.get(category_id)
    if category is None:
        raise invalid("CATEGORY_NOT_FOUND", "分类不存在", {"category_id": category_id})
    if category.parent_id is None:
        return [c.id for c in categories.values() if c.parent_id == category_id]
    return [category_id]


def list_transactions(
    db: Session,
    month: str | None = None,
    channel_id: int | None = None,
    budget_account_id: int | None = None,
    category_id: int | None = None,
    refund_status: RefundStatus | None = None,
    page: int = 1,
    page_size: int = 50,
) -> TransactionPage:
    """Every channel, newest first. Filters combine; a level-1 `category_id` matches all of
    its level-2 children, and `budget_account_id` the categories that belong to it now.

    Rows are the ledger: filtered by their own date and channel, and by the category they
    count in (a matched refund's is its payment's, which is the one shown). `stats` use the
    effective attribution throughout (month, category and channel of the payment), the
    same as the summaries. `refund_status="unmatched"` lists only refunds without a payment.
    """
    names = _load_names(db)
    categories = names.categories
    start = end = None
    if month:
        start = parse_month(month)
        end = add_months(start, 1)
    leaf_ids: set[int] | None = None
    if budget_account_id is not None:
        get_budget_account(db, budget_account_id, status_code=422)
        leaf_ids = {c.id for c in categories.values() if c.budget_account_id == budget_account_id}
    if category_id is not None:
        ids = set(_leaf_ids(categories, category_id))
        leaf_ids = ids if leaf_ids is None else leaf_ids & ids
    if channel_id is not None:
        get_channel(db, channel_id, status_code=422)

    conditions = []
    if start is not None:
        conditions += [Transaction.date >= start, Transaction.date < end]
    if channel_id is not None:
        conditions.append(Transaction.channel_id == channel_id)
    if leaf_ids is not None:
        conditions.append(effective_category.in_(leaf_ids))
    if refund_status == "unmatched":
        conditions += [Transaction.amount < 0, Transaction.refund_of_id.is_(None)]
    total = db.scalar(join_payment(select(func.count())).where(*conditions))
    rows = list(
        db.scalars(
            join_payment(select(Transaction))
            .where(*conditions)
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    )
    totals = sum_totals(
        list(
            effective_totals(
                db,
                category_ids=None if leaf_ids is None else sorted(leaf_ids),
                start=start,
                end=end,
                channel_id=channel_id,
                unmatched_refunds_only=refund_status == "unmatched",
            ).values()
        )
    )
    return TransactionPage(
        items=_outputs(db, rows, names),
        total=total,
        page=page,
        page_size=page_size,
        stats=TransactionStats(count=totals.count, net_amount=totals.amount),
    )


def _get_transaction(db: Session, transaction_id: int) -> Transaction:
    transaction = get_by_id(db, Transaction, transaction_id)
    if transaction is None:
        raise not_found("TRANSACTION_NOT_FOUND", "流水不存在")
    return transaction


def _lock_transaction(db: Session, transaction_id: int, *others: int) -> dict[int, Transaction]:
    """Locks the transaction (and `others`); 404 if it is gone."""
    locked = lock_transactions(db, {transaction_id, *others})
    if transaction_id not in locked:
        db.rollback()
        raise not_found("TRANSACTION_NOT_FOUND", "流水不存在")
    return locked


def update_transaction(
    db: Session, transaction_id: int, changes: TransactionUpdateIn
) -> TransactionOut:
    """`category_id`, `note` and, for a refund, `refund_of_id` change; fields absent from
    the request are untouched. The channel is fixed. Any level-2 category may be chosen,
    except for a matched refund, whose category follows its payment."""
    fields = changes.model_fields_set
    transaction = _get_transaction(db, transaction_id)
    names = _load_names(db)
    if "refund_of_id" in fields and changes.refund_of_id is not None:
        target_id = changes.refund_of_id
        locked = _lock_transaction(db, transaction_id, target_id)
        transaction = locked[transaction_id]
        target = locked.get(target_id) if target_id != transaction_id else None
        facts = None
        if target is not None:
            already = refunded_amounts(db, {target.id}, exclude_refund_id=transaction.id)
            facts = RefundTargetFacts(target.amount, target.date, already.get(target.id, ZERO))
        error = refund_match_error(
            transaction.amount, transaction.date, facts, {"refund_of_id": target_id}
        )
        if error is not None:
            db.rollback()
            raise error
        transaction.refund_of_id = target_id
    elif "refund_of_id" in fields:
        transaction.refund_of_id = None
    if "category_id" in fields:
        details = {"category_id": changes.category_id}
        if transaction.refund_of_id is not None:
            db.rollback()
            raise invalid(
                "REFUND_CATEGORY_FOLLOWS_PAYMENT",
                "已匹配的退款分类跟随原支付，不能单独修改；请先取消匹配",
                {**details, "refund_of_id": transaction.refund_of_id},
            )
        category = names.categories.get(changes.category_id)
        if category is None:
            db.rollback()
            raise invalid("CATEGORY_NOT_FOUND", "分类不存在", details)
        if category.parent_id is None:
            db.rollback()
            raise invalid("CATEGORY_NOT_LEAF", "流水只能归入二级分类", details)
        transaction.category_id = category.id
    if "note" in fields:
        transaction.note = changes.note
    db.flush()
    result = _outputs(db, [transaction], names)[0]
    db.commit()
    return result


def delete_transaction(db: Session, transaction_id: int) -> None:
    """A payment that still has matched refunds cannot be deleted (409
    `TRANSACTION_HAS_REFUNDS`); a refund always can."""
    _get_transaction(db, transaction_id)
    transaction = _lock_transaction(db, transaction_id)[transaction_id]
    if transaction.amount > 0:
        refund_ids = list(
            db.scalars(
                select(Transaction.id)
                .where(Transaction.refund_of_id == transaction_id)
                .order_by(Transaction.id)
            )
        )
        if refund_ids:
            db.rollback()
            raise conflict(
                "TRANSACTION_HAS_REFUNDS",
                f"这笔支付已匹配 {len(refund_ids)} 笔退款，请先取消匹配或删除对应退款",
                {"refund_ids": refund_ids},
            )
    db.delete(transaction)
    db.commit()


def list_refunds(db: Session, transaction_id: int) -> list[TransactionOut]:
    """The refunds matched to a payment, oldest first; none for a refund."""
    _get_transaction(db, transaction_id)
    rows = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.refund_of_id == transaction_id)
            .order_by(Transaction.date, Transaction.id)
        )
    )
    return _outputs(db, rows, _load_names(db))


def _contains(value: str) -> str:
    """An ILIKE pattern matching `value` anywhere, with its wildcards taken literally."""
    escaped = value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def refund_candidates(
    db: Session, transaction_id: int, q: str | None = None, page: int = 1, page_size: int = 20
) -> RefundCandidatePage:
    """Payments the refund may be matched to: dated on or before it, with enough left to
    refund. Same channel and same counterparty first, then newest first. `q` searches
    counterparty and description. The refund's own current match counts as not refunded,
    so its payment is listed too."""
    refund = _get_transaction(db, transaction_id)
    if refund.amount > 0:
        raise invalid(
            "INVALID_REFUND_TARGET",
            "只有退款（金额为负）可以匹配原支付",
            {"transaction_id": transaction_id},
        )
    names = _load_names(db)
    refunded = refunded_subquery(exclude_refund_id=refund.id)
    conditions = [
        Transaction.amount > 0,
        Transaction.date <= refund.date,
        Transaction.amount + func.coalesce(refunded.c.refunded, 0) >= -refund.amount,
    ]
    text = (q or "").strip()
    if text:
        pattern = _contains(text)
        conditions.append(
            or_(
                Transaction.counterparty.ilike(pattern, escape="\\"),
                Transaction.description.ilike(pattern, escape="\\"),
            )
        )
    likely = and_(
        Transaction.channel_id == refund.channel_id,
        func.lower(func.trim(Transaction.counterparty))
        == func.lower(func.trim(literal(refund.counterparty))),
    )

    def base(statement):
        return statement.select_from(Transaction).outerjoin(
            refunded, refunded.c.payment_id == Transaction.id
        )

    total = db.scalar(base(select(func.count())).where(*conditions))
    rows = list(
        db.scalars(
            base(select(Transaction))
            .where(*conditions)
            .order_by(case((likely, 0), else_=1), Transaction.date.desc(), Transaction.id.desc())
            .limit(page_size)
            .offset((page - 1) * page_size)
        )
    )
    return RefundCandidatePage(
        items=_outputs(db, rows, names), total=total, page=page, page_size=page_size
    )


def search_payments(
    db: Session,
    date_from: date,
    date_to: date,
    channel_id: int | None = None,
    counterparty: str | None = None,
    limit: int = 20,
) -> PaymentSearchOut:
    """Stored payments only (never refunds), for an agent looking for a refund's original
    payment: the dates are inclusive and span at most `MAX_PAYMENT_SEARCH_DAYS` days;
    `counterparty` matches anywhere, ignoring case. Newest first."""
    _check_search_bounds(date_from, date_to, limit)
    conditions = [
        Transaction.amount > 0,
        Transaction.date >= date_from,
        Transaction.date <= date_to,
    ]
    if channel_id is not None:
        get_channel(db, channel_id, status_code=422)
        conditions.append(Transaction.channel_id == channel_id)
    text = (counterparty or "").strip()
    if text:
        conditions.append(Transaction.counterparty.ilike(_contains(text), escape="\\"))
    rows = list(
        db.scalars(
            select(Transaction)
            .where(*conditions)
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(limit)
        )
    )
    names = _load_names(db)
    refunded = refunded_amounts(db, {row.id for row in rows})
    payments = []
    for row in rows:
        done = refunded.get(row.id, ZERO).quantize(CENT)
        payments.append(
            PaymentOut(
                id=row.id,
                channel_id=row.channel_id,
                channel_name=names.channels[row.channel_id],
                date=row.date,
                amount=row.amount,
                counterparty=row.counterparty,
                description=row.description,
                category_id=row.category_id,
                category_name=names.categories[row.category_id].name,
                refunded=done,
                refundable=row.amount - done,
            )
        )
    return PaymentSearchOut(payments=payments)


def _check_search_bounds(date_from: date, date_to: date, limit: int) -> None:
    """What both agent searches allow: `MAX_PAYMENT_SEARCH_DAYS` days at most (both ends
    counted) and 1 to `MAX_PAYMENT_SEARCH_LIMIT` rows."""
    if date_from > date_to or (date_to - date_from).days >= MAX_PAYMENT_SEARCH_DAYS:
        raise invalid(
            "INVALID_DATE_RANGE",
            f"日期范围无效：date_from 不能晚于 date_to，且最多跨 {MAX_PAYMENT_SEARCH_DAYS} 天",
            {
                "date_from": date_from.isoformat(),
                "date_to": date_to.isoformat(),
                "max_days": MAX_PAYMENT_SEARCH_DAYS,
            },
        )
    if not 1 <= limit <= MAX_PAYMENT_SEARCH_LIMIT:
        raise invalid(
            "INVALID_LIMIT",
            f"limit 须在 1 到 {MAX_PAYMENT_SEARCH_LIMIT} 之间",
            {"limit": limit, "max_limit": MAX_PAYMENT_SEARCH_LIMIT},
        )


def search_transactions(
    db: Session,
    date_from: date,
    date_to: date,
    channel_id: int | None = None,
    category_id: int | None = None,
    q: str | None = None,
    kind: TransactionKind | None = None,
    limit: int = 20,
) -> TransactionSearchOut:
    """Stored payments and refunds, for an agent looking for transactions to recategorize.
    Same date and limit bounds as `search_payments`. A level-1 `category_id` matches all of
    its level-2 children; a matched refund is found by its payment's category, the one it
    counts in (as `list_transactions` does). `q` matches counterparty or description
    anywhere, ignoring case. Newest first."""
    _check_search_bounds(date_from, date_to, limit)
    names = _load_names(db)
    conditions = [Transaction.date >= date_from, Transaction.date <= date_to]
    if channel_id is not None:
        get_channel(db, channel_id, status_code=422)
        conditions.append(Transaction.channel_id == channel_id)
    if category_id is not None:
        conditions.append(effective_category.in_(_leaf_ids(names.categories, category_id)))
    text = (q or "").strip()
    if text:
        pattern = _contains(text)
        conditions.append(
            or_(
                Transaction.counterparty.ilike(pattern, escape="\\"),
                Transaction.description.ilike(pattern, escape="\\"),
            )
        )
    if kind == "payment":
        conditions.append(Transaction.amount > 0)
    elif kind == "refund":
        conditions.append(Transaction.amount < 0)
    rows = list(
        db.scalars(
            join_payment(select(Transaction))
            .where(*conditions)
            .order_by(Transaction.date.desc(), Transaction.id.desc())
            .limit(limit)
        )
    )
    return TransactionSearchOut(transactions=_outputs(db, rows, names))


def _change_line(old: Category, new: Category, names: _Names, reason: str) -> str:
    """The line an agent's category change appends to the note."""

    def path(category: Category) -> str:
        return f"{names.categories[category.parent_id].name}/{category.name}"

    return f"[Agent 改分类] {path(old)} → {path(new)}：{reason}"


def recategorize(db: Session, raw_items: list[Any]) -> RecategorizeAcceptedOut:
    """An agent's category changes: every item or none.

    Each item moves one stored transaction to another level-2 category and appends a line
    with the old and new category and the agent's reason to its note; nothing else
    changes. Raises `BATCH_REJECTED` (409) with one feedback entry per item when any item
    is rejected. The transactions are locked (`FOR UPDATE`) from the checks to the commit.
    """
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= MAX_RECATEGORIZE_ITEMS:
        raise invalid(
            "INVALID_BATCH_SIZE",
            f"每批需包含 1 到 {MAX_RECATEGORIZE_ITEMS} 条修改",
            {"max_items": MAX_RECATEGORIZE_ITEMS},
        )
    names = _load_names(db)
    choices = _category_choices(names)
    feedback: list[dict[str, Any] | None] = [None] * len(raw_items)
    parsed: dict[int, RecategorizeItemIn] = {}
    first_index: dict[int, int] = {}
    for index, raw in enumerate(raw_items):
        try:
            item = RecategorizeItemIn.model_validate(raw)
        except ValidationError as exc:
            feedback[index] = _invalid_field(index, exc)
            continue
        earlier = first_index.setdefault(item.transaction_id, index)
        if earlier != index:
            feedback[index] = _rejected(
                index,
                "DUPLICATE_TRANSACTION",
                f"与本批第 {earlier} 条（index={earlier}）是同一笔流水，每笔每批只能改一次",
                transaction_id=item.transaction_id,
                duplicate_of_index=earlier,
            )
            continue
        parsed[index] = item

    locked = lock_transactions(db, {item.transaction_id for item in parsed.values()})
    notes: dict[int, str] = {}
    for index, item in parsed.items():
        transaction = locked.get(item.transaction_id)
        if transaction is None:
            feedback[index] = _rejected(
                index,
                "TRANSACTION_NOT_FOUND",
                f"流水 {item.transaction_id} 不存在",
                transaction_id=item.transaction_id,
            )
            continue
        rejection = _category_rejection(index, item.category_id, names, choices)
        if rejection is not None:
            feedback[index] = rejection
            continue
        if transaction.refund_of_id is not None:
            feedback[index] = _rejected(
                index,
                "REFUND_CATEGORY_FOLLOWS_PAYMENT",
                "已匹配的退款分类跟随原支付，不能单独修改",
                category_id=item.category_id,
                refund_of_id=transaction.refund_of_id,
            )
            continue
        if transaction.category_id == item.category_id:
            feedback[index] = _rejected(
                index,
                "CATEGORY_UNCHANGED",
                "流水已在该分类下，无需修改",
                category_id=item.category_id,
            )
            continue
        line = _change_line(
            names.categories[transaction.category_id],
            names.categories[item.category_id],
            names,
            item.reason,
        )
        note = f"{transaction.note}\n{line}" if transaction.note else line
        if len(note) > MAX_NOTE_LENGTH:
            feedback[index] = _rejected(
                index,
                "NOTE_TOO_LONG",
                f"追加原因后备注将超过 {MAX_NOTE_LENGTH} 字，请缩短原因",
                max_length=MAX_NOTE_LENGTH,
                length=len(note),
            )
            continue
        notes[index] = note
        feedback[index] = {"index": index, "status": "ok"}

    _raise_if_rejected(db, feedback)

    changed = []
    for index, item in parsed.items():
        transaction = locked[item.transaction_id]
        transaction.category_id = item.category_id
        transaction.note = notes[index]
        changed.append(transaction)
    db.flush()
    result = RecategorizeAcceptedOut(transactions=_outputs(db, changed, names))
    db.commit()
    return result
