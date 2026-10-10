from fastapi import APIRouter

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.schemas.budget import BudgetsOut, BudgetsPutIn
from app.schemas.common import Month
from app.services import budgets as budget_service

router = APIRouter(tags=["budgets"])


@router.get("/accounts/{account_id}/budgets", response_model=BudgetsOut)
def get_budgets(
    account_id: int, principal: AnyPrincipal, db: DbSession, month: Month | None = None
):
    """Budget in force per level-2 category for `month` (default: current month).
    Open to agent tokens."""
    return budget_service.get_budgets(db, account_id, month)


@router.put("/accounts/{account_id}/budgets", response_model=BudgetsOut)
def set_budgets(account_id: int, payload: BudgetsPutIn, principal: SessionPrincipal, db: DbSession):
    """Sets amounts effective from a month; earlier months keep their version.
    An `amount` of null clears that category's budget from the month on."""
    return budget_service.set_budgets(db, account_id, payload.effective_from, payload.items)
