from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.account import AccountCreateIn, AccountOut, AccountUpdateIn
from app.services import accounts as account_service

router = APIRouter(tags=["accounts"])


@router.get("/accounts", response_model=list[AccountOut])
def list_accounts(principal: SessionPrincipal, db: DbSession):
    return account_service.list_accounts(db)


@router.post("/accounts", response_model=AccountOut, status_code=201)
def create_account(payload: AccountCreateIn, principal: SessionPrincipal, db: DbSession):
    return account_service.create_account(db, payload.name, payload.currency)


@router.patch("/accounts/{account_id}", response_model=AccountOut)
def rename_account(
    account_id: int, payload: AccountUpdateIn, principal: SessionPrincipal, db: DbSession
):
    return account_service.rename_account(db, account_id, payload.name)
