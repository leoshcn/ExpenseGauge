from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.errors import ErrorEnvelope
from app.schemas.common import Money, Month
from app.schemas.transaction import (
    MAX_SEARCH_TEXT,
    BatchAcceptedOut,
    BatchSubmitIn,
    BulkUpdateIn,
    BulkUpdateOut,
    PaymentSearchOut,
    RecategorizeAcceptedOut,
    RecategorizeIn,
    RefundCandidatePage,
    RestoreOut,
    TagCount,
    TagRenameIn,
    TagRenameOut,
    TransactionIdsIn,
    TransactionKind,
    TransactionOut,
    TransactionPage,
    TransactionSearchOut,
    TransactionUpdateIn,
)
from app.services import tags as tag_service
from app.services import transaction_trash as trash_service
from app.services import transactions as transaction_service

router = APIRouter(tags=["transactions"])


@router.post(
    "/channels/{channel_id}/transactions/batch",
    response_model=BatchAcceptedOut,
    status_code=201,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "BATCH_REJECTED: nothing written; details.items has one entry per item",
        }
    },
)
def submit_batch(channel_id: int, payload: BatchSubmitIn, principal: AnyPrincipal, db: DbSession):
    """All-or-nothing submission of one payment channel's transactions. Open to agent tokens."""
    return transaction_service.submit_batch(
        db, channel_id, payload.items, api_token_id=principal.api_token_id
    )


@router.get("/transactions", response_model=TransactionPage)
def list_transactions(
    principal: SessionPrincipal,
    db: DbSession,
    month: Month | None = None,
    channel_id: int | None = None,
    budget_account_id: int | None = None,
    category_id: int | None = None,
    refund_status: Annotated[
        transaction_service.RefundStatus | None,
        Query(description="`unmatched`: only refunds not matched to a payment"),
    ] = None,
    q: Annotated[
        str | None,
        Query(
            max_length=MAX_SEARCH_TEXT,
            description="Text in the row's own counterparty, description or note",
        ),
    ] = None,
    amount_min: Annotated[
        Money | None, Query(ge=0, description="Absolute amount at least this")
    ] = None,
    amount_max: Annotated[
        Money | None, Query(ge=0, description="Absolute amount at most this")
    ] = None,
    date_from: Annotated[date | None, Query(description="Own date on or after")] = None,
    date_to: Annotated[date | None, Query(description="Own date on or before")] = None,
    tag: Annotated[
        list[str] | None,
        Query(description="Tags (without `#`), any of; a matched refund has its payment's"),
    ] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
):
    """The ledger, newest first, with `stats` (consumption count and net amount) for the
    same filters by effective attribution, as the summaries count."""
    return transaction_service.list_transactions(
        db,
        month=month,
        channel_id=channel_id,
        budget_account_id=budget_account_id,
        category_id=category_id,
        refund_status=refund_status,
        q=q,
        amount_min=amount_min,
        amount_max=amount_max,
        date_from=date_from,
        date_to=date_to,
        tags=tag,
        page=page,
        page_size=page_size,
    )


@router.get("/transactions/tags", response_model=list[TagCount])
def list_tags(principal: SessionPrincipal, db: DbSession):
    """Every `#tag` written in a note, most used first."""
    return tag_service.list_tags(db)


@router.post("/transactions/tags/rename", response_model=TagRenameOut)
def rename_tag(payload: TagRenameIn, principal: SessionPrincipal, db: DbSession):
    """Writes `#from_tag` as `#to_tag` in every note; returns the notes as they were."""
    return tag_service.rename_tag(db, payload.from_tag, payload.to_tag)


@router.post(
    "/transactions/bulk-update",
    response_model=BulkUpdateOut,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "BATCH_REJECTED: nothing changed; details.items has one entry per item",
        }
    },
)
def bulk_update(payload: BulkUpdateIn, principal: SessionPrincipal, db: DbSession):
    """The user's category and note changes to several transactions, all or none."""
    return transaction_service.bulk_update(db, payload.items)


@router.post(
    "/transactions/bulk-delete",
    status_code=204,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "TRANSACTION_HAS_REFUNDS: a payment's matched refunds are not included",
        }
    },
)
def bulk_delete(payload: TransactionIdsIn, principal: SessionPrincipal, db: DbSession):
    """Deletes all of `ids` or none; each can be restored for a week."""
    trash_service.bulk_delete(db, payload.ids)


@router.post(
    "/transactions/restore",
    response_model=RestoreOut,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "RESTORE_CONFLICT: nothing restored; details.items says why per id",
        }
    },
)
def restore(payload: TransactionIdsIn, principal: SessionPrincipal, db: DbSession):
    """Undoes deletes: puts the transactions back under their own ids, all or none."""
    return trash_service.restore(db, payload.ids)


@router.get("/transactions/search", response_model=TransactionSearchOut)
def search_transactions(
    principal: AnyPrincipal,
    db: DbSession,
    date_from: date,
    date_to: date,
    channel_id: int | None = None,
    category_id: int | None = None,
    q: Annotated[str | None, Query(max_length=200)] = None,
    kind: TransactionKind | None = None,
    limit: int = 20,
):
    """Stored payments and refunds between two dates (inclusive, at most 366 days), to find
    transactions to recategorize. A level-1 `category_id` matches its level-2 children; `q`
    searches counterparty and description. Open to agent tokens; the MCP
    `find_transactions` tool returns the same."""
    return transaction_service.search_transactions(
        db,
        date_from,
        date_to,
        channel_id=channel_id,
        category_id=category_id,
        q=q,
        kind=kind,
        limit=limit,
    )


@router.post(
    "/transactions/recategorize",
    response_model=RecategorizeAcceptedOut,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "BATCH_REJECTED: nothing changed; details.items has one entry per item",
        }
    },
)
def recategorize(payload: RecategorizeIn, principal: AnyPrincipal, db: DbSession):
    """All-or-nothing category changes, each with a reason appended to the transaction's
    note. Open to agent tokens; the MCP `recategorize_transactions` tool does the same."""
    return transaction_service.recategorize(db, payload.items)


@router.get("/transactions/{transaction_id}/refund-candidates", response_model=RefundCandidatePage)
def refund_candidates(
    transaction_id: int,
    principal: SessionPrincipal,
    db: DbSession,
    q: Annotated[str | None, Query(max_length=200)] = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=100)] = 20,
):
    """Payments this refund may be matched to (dated on or before it, enough left to
    refund): same channel and counterparty first, then newest first. `q` searches
    counterparty and description."""
    return transaction_service.refund_candidates(
        db, transaction_id, q=q, page=page, page_size=page_size
    )


@router.get("/transactions/{transaction_id}/refunds", response_model=list[TransactionOut])
def list_refunds(transaction_id: int, principal: SessionPrincipal, db: DbSession):
    """The refunds matched to this payment, oldest first (empty for a refund)."""
    return transaction_service.list_refunds(db, transaction_id)


@router.patch("/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int, payload: TransactionUpdateIn, principal: SessionPrincipal, db: DbSession
):
    """Category and note; for a refund also `refund_of_id` (match, re-match, or null to
    remove the match). A matched refund's category follows its payment."""
    return transaction_service.update_transaction(db, transaction_id, payload)


@router.delete(
    "/transactions/{transaction_id}",
    status_code=204,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "TRANSACTION_HAS_REFUNDS: a payment with matched refunds",
        }
    },
)
def delete_transaction(transaction_id: int, principal: SessionPrincipal, db: DbSession):
    """A payment that still has matched refunds is refused (409); a refund never is."""
    transaction_service.delete_transaction(db, transaction_id)


@router.get("/payments/search", response_model=PaymentSearchOut)
def search_payments(
    principal: AnyPrincipal,
    db: DbSession,
    date_from: date,
    date_to: date,
    channel_id: int | None = None,
    counterparty: str | None = None,
    limit: int = 20,
):
    """Stored payments (never refunds) between two dates (inclusive, at most 366 days),
    to find the payment a refund reverses. Open to agent tokens; the MCP `find_payments`
    tool returns the same."""
    return transaction_service.search_payments(
        db, date_from, date_to, channel_id=channel_id, counterparty=counterparty, limit=limit
    )
