from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.errors import ErrorEnvelope
from app.schemas.common import Month
from app.schemas.transaction import (
    BatchAcceptedOut,
    BatchSubmitIn,
    TransactionOut,
    TransactionPage,
    TransactionUpdateIn,
)
from app.services import transactions as transaction_service

router = APIRouter(tags=["transactions"])


@router.post(
    "/accounts/{account_id}/transactions/batch",
    response_model=BatchAcceptedOut,
    status_code=201,
    responses={
        409: {
            "model": ErrorEnvelope,
            "description": "BATCH_REJECTED: nothing written; details.items has one entry per item",
        }
    },
)
def submit_batch(account_id: int, payload: BatchSubmitIn, principal: AnyPrincipal, db: DbSession):
    """All-or-nothing submission. Open to agent tokens."""
    return transaction_service.submit_batch(
        db, account_id, payload.items, api_token_id=principal.api_token_id
    )


@router.get("/accounts/{account_id}/transactions", response_model=TransactionPage)
def list_transactions(
    account_id: int,
    principal: SessionPrincipal,
    db: DbSession,
    month: Month | None = None,
    category_id: int | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int, Query(ge=1, le=200)] = 50,
):
    return transaction_service.list_transactions(
        db, account_id, month=month, category_id=category_id, page=page, page_size=page_size
    )


@router.patch("/transactions/{transaction_id}", response_model=TransactionOut)
def update_transaction(
    transaction_id: int, payload: TransactionUpdateIn, principal: SessionPrincipal, db: DbSession
):
    return transaction_service.update_transaction(db, transaction_id, payload)


@router.delete("/transactions/{transaction_id}", status_code=204)
def delete_transaction(transaction_id: int, principal: SessionPrincipal, db: DbSession):
    transaction_service.delete_transaction(db, transaction_id)
