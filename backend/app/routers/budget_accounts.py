from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.budget_account import (
    BudgetAccountCreateIn,
    BudgetAccountOut,
    BudgetAccountUpdateIn,
)
from app.services import budget_accounts as budget_account_service

router = APIRouter(tags=["budget-accounts"])


@router.get("/budget-accounts", response_model=list[BudgetAccountOut])
def list_budget_accounts(principal: SessionPrincipal, db: DbSession):
    return budget_account_service.list_budget_accounts(db)


@router.post("/budget-accounts", response_model=BudgetAccountOut, status_code=201)
def create_budget_account(
    payload: BudgetAccountCreateIn, principal: SessionPrincipal, db: DbSession
):
    return budget_account_service.create_budget_account(db, payload.name)


@router.patch("/budget-accounts/{budget_account_id}", response_model=BudgetAccountOut)
def rename_budget_account(
    budget_account_id: int,
    payload: BudgetAccountUpdateIn,
    principal: SessionPrincipal,
    db: DbSession,
):
    return budget_account_service.rename_budget_account(db, budget_account_id, payload.name)
