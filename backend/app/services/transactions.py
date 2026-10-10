"""Transactions: all-or-nothing batch submission with per-item feedback, list, edit, delete."""

import hashlib
import re
import unicodedata
from datetime import date
from decimal import Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import AppError, invalid, not_found
from app.models import Category, Transaction
from app.months import add_months, parse_month
from app.schemas.category import CategoryLeaf
from app.schemas.transaction import (
    MAX_BATCH_ITEMS,
    BatchAcceptedOut,
    TransactionItemIn,
    TransactionOut,
    TransactionPage,
    TransactionUpdateIn,
)
from app.services.accounts import get_account
from app.services.categories import build_nodes, load_categories
from app.services.locks import lock_account_transactions

_WHITESPACE = re.compile(r"\s+")
CENT = Decimal("0.01")

DUPLICATE_HINT = "与用户确认后，带 confirm_duplicate=true 重新提交该条"


def normalize_text(value: str) -> str:
    """NFKC, trim, collapse whitespace, casefold."""
    return _WHITESPACE.sub(" ", unicodedata.normalize("NFKC", value)).strip().casefold()


def compute_fingerprint(
    account_id: int, day: date, amount: Decimal, counterparty: str, description: str
) -> str:
    parts = [
        str(account_id),
        day.isoformat(),
        f"{amount:.2f}",
        normalize_text(counterparty),
        normalize_text(description),
    ]
    return hashlib.sha256("|".join(parts).encode()).hexdigest()


def to_out(transaction: Transaction, categories: dict[int, Category]) -> TransactionOut:
    category = categories[transaction.category_id]
    parent = categories[category.parent_id]
    return TransactionOut(
        id=transaction.id,
        account_id=transaction.account_id,
        category_id=category.id,
        category_name=category.name,
        parent_category_id=parent.id,
        parent_category_name=parent.name,
        date=transaction.date,
        amount=transaction.amount,
        counterparty=transaction.counterparty,
        description=transaction.description,
        note=transaction.note,
        confirmed_duplicate=transaction.confirmed_duplicate,
        created_at=transaction.created_at,
    )


def _rejected(index: int, code: str, message: str, **extra: Any) -> dict[str, Any]:
    return {"index": index, "status": "rejected", "code": code, "message": message, **extra}


def _field_errors(exc: ValidationError) -> list[dict[str, str]]:
    return [
        {"field": ".".join(str(part) for part in error["loc"]) or "item", "reason": error["msg"]}
        for error in exc.errors()
    ]


def submit_batch(
    db: Session, account_id: int, raw_items: list[Any], api_token_id: int | None = None
) -> BatchAcceptedOut:
    """Stores every item or none.

    Raises `BATCH_REJECTED` (409) carrying one feedback entry per item when any item is
    rejected. Validation and insert share one database transaction that holds the
    account's advisory lock, so concurrent batches cannot both pass the duplicate check.
    """
    get_account(db, account_id)
    if not isinstance(raw_items, list) or not 1 <= len(raw_items) <= MAX_BATCH_ITEMS:
        raise invalid(
            "INVALID_BATCH_SIZE",
            f"每批需包含 1 到 {MAX_BATCH_ITEMS} 条流水",
            {"max_items": MAX_BATCH_ITEMS},
        )

    lock_account_transactions(db, account_id)

    category_rows = load_categories(db, account_id)
    categories = {c.id: c for c in category_rows}
    nodes = build_nodes(category_rows)
    valid_categories = [node.model_dump(mode="json") for node in nodes]
    children_of = {node.id: node.children for node in nodes}

    feedback: list[dict[str, Any] | None] = [None] * len(raw_items)
    parsed: dict[int, tuple[TransactionItemIn, str]] = {}

    for index, raw in enumerate(raw_items):
        try:
            item = TransactionItemIn.model_validate(raw)
        except ValidationError as exc:
            errors = _field_errors(exc)
            fields = "、".join(sorted({error["field"] for error in errors}))
            feedback[index] = _rejected(
                index, "INVALID_FIELD", f"字段无效：{fields}", errors=errors
            )
            continue
        category = categories.get(item.category_id)
        if category is None:
            feedback[index] = _rejected(
                index,
                "CATEGORY_NOT_FOUND",
                f"分类 {item.category_id} 不存在或不属于该账户，"
                "请从 valid_categories 的二级分类中选择",
                valid_categories=valid_categories,
            )
            continue
        if category.parent_id is None:
            children: list[CategoryLeaf] = children_of[category.id]
            feedback[index] = _rejected(
                index,
                "CATEGORY_NOT_LEAF",
                f"“{category.name}”是一级分类，流水只能归入其下的二级分类",
                parent={"id": category.id, "name": category.name},
                children=[child.model_dump(mode="json") for child in children],
            )
            continue
        fingerprint = compute_fingerprint(
            account_id, item.date, item.amount, item.counterparty, item.description
        )
        parsed[index] = (item, fingerprint)

    existing_by_fingerprint: dict[str, Transaction] = {}
    fingerprints = {fingerprint for _, fingerprint in parsed.values()}
    if fingerprints:
        rows = db.scalars(
            select(Transaction)
            .where(Transaction.account_id == account_id, Transaction.fingerprint.in_(fingerprints))
            .order_by(Transaction.id.desc())
        )
        for row in rows:  # descending, so the earliest stored match wins
            existing_by_fingerprint[row.fingerprint] = row

    first_index_in_batch: dict[str, int] = {}
    to_insert: list[Transaction] = []
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
                    f"疑似重复：系统中已有一条 {existing.date.isoformat()} "
                    f"{existing.counterparty} {existing.amount:.2f} 的流水",
                    existing=to_out(existing, categories).model_dump(mode="json"),
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
        to_insert.append(
            Transaction(
                account_id=account_id,
                category_id=item.category_id,
                date=item.date,
                amount=item.amount.quantize(CENT),  # as NUMERIC(14,2) stores it
                counterparty=item.counterparty,
                description=item.description,
                note=item.note,
                fingerprint=fingerprint,
                # The flag only means something when there was a match; otherwise it is ignored.
                confirmed_duplicate=is_duplicate,
                api_token_id=api_token_id,
            )
        )

    rejected_count = sum(1 for entry in feedback if entry and entry["status"] == "rejected")
    if rejected_count:
        db.rollback()  # releases the advisory lock; nothing was written
        raise AppError(
            409,
            "BATCH_REJECTED",
            f"本批共 {len(raw_items)} 条，其中 {rejected_count} 条被拒绝，未写入任何数据",
            {"items": feedback},
        )

    db.add_all(to_insert)
    db.flush()
    result = BatchAcceptedOut(transactions=[to_out(row, categories) for row in to_insert])
    db.commit()
    return result


def list_transactions(
    db: Session,
    account_id: int,
    month: str | None = None,
    category_id: int | None = None,
    page: int = 1,
    page_size: int = 50,
) -> TransactionPage:
    """Newest first. A level-1 `category_id` matches all of its level-2 children."""
    get_account(db, account_id)
    categories = {c.id: c for c in load_categories(db, account_id)}
    conditions = [Transaction.account_id == account_id]
    if month:
        start = parse_month(month)
        conditions += [Transaction.date >= start, Transaction.date < add_months(start, 1)]
    if category_id is not None:
        category = categories.get(category_id)
        if category is None:
            raise invalid(
                "CATEGORY_NOT_FOUND", "分类不存在或不属于该账户", {"category_id": category_id}
            )
        if category.parent_id is None:
            ids = [c.id for c in categories.values() if c.parent_id == category_id]
            conditions.append(Transaction.category_id.in_(ids))
        else:
            conditions.append(Transaction.category_id == category_id)
    total = db.scalar(select(func.count()).select_from(Transaction).where(*conditions))
    rows = db.scalars(
        select(Transaction)
        .where(*conditions)
        .order_by(Transaction.date.desc(), Transaction.id.desc())
        .limit(page_size)
        .offset((page - 1) * page_size)
    )
    return TransactionPage(
        items=[to_out(row, categories) for row in rows],
        total=total,
        page=page,
        page_size=page_size,
    )


def _get_transaction(db: Session, transaction_id: int) -> Transaction:
    transaction = get_by_id(db, Transaction, transaction_id)
    if transaction is None:
        raise not_found("TRANSACTION_NOT_FOUND", "流水不存在")
    return transaction


def update_transaction(
    db: Session, transaction_id: int, changes: TransactionUpdateIn
) -> TransactionOut:
    """Only `category_id` and `note` change; fields absent from the request are untouched."""
    transaction = _get_transaction(db, transaction_id)
    categories = {c.id: c for c in load_categories(db, transaction.account_id)}
    if "category_id" in changes.model_fields_set:
        details = {"category_id": changes.category_id}
        category = categories.get(changes.category_id)
        if category is None:
            raise invalid("CATEGORY_NOT_FOUND", "分类不存在或不属于该流水所在账户", details)
        if category.parent_id is None:
            raise invalid("CATEGORY_NOT_LEAF", "流水只能归入二级分类", details)
        transaction.category_id = category.id
    if "note" in changes.model_fields_set:
        transaction.note = changes.note
    db.commit()
    return to_out(transaction, categories)


def delete_transaction(db: Session, transaction_id: int) -> None:
    db.delete(_get_transaction(db, transaction_id))
    db.commit()
