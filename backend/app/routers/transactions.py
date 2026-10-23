from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.errors import ErrorEnvelope
from app.schemas.common import Month
from app.schemas.transaction import (
    BatchAcceptedOut,
    BatchSubmitIn,
    PaymentSearchOut,
    RecategorizeAcceptedOut,
    RecategorizeIn,
    RefundCandidatePage,
    TransactionKind,
    TransactionOut,
    TransactionPage,
    TransactionSearchOut,
    TransactionUpdateIn,
)
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
        page=page,
        page_size=page_size,
    )


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
