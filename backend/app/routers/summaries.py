from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import DbSession, SessionPrincipal
from app.schemas.common import Month
from app.schemas.summary import AnnualSummaryOut, MonthDetailOut, MonthlySummaryOut
from app.services import summaries as summary_service

router = APIRouter(tags=["summary"])


@router.get("/summary/monthly", response_model=MonthlySummaryOut)
def monthly_summary(
    principal: SessionPrincipal,
    db: DbSession,
    from_month: Annotated[Month | None, Query(alias="from")] = None,
    to_month: Annotated[Month | None, Query(alias="to")] = None,
    budget_account_id: int | None = None,
):
    """Per month: total budget and total actual, for everything or one budget account.
    Defaults to the 12 months ending at `to`. Budget and actual cover monthly budget
    accounts only; annual accounts' spending is `annual_actual`."""
    return summary_service.get_monthly_summary(db, from_month, to_month, budget_account_id)


@router.get("/summary/months/{month}", response_model=MonthDetailOut)
def month_detail(
    month: Month,
    principal: SessionPrincipal,
    db: DbSession,
    budget_account_id: int | None = None,
):
    """Level-1 rows with nested level-2 rows: budget and actual, for monthly budget
    accounts' categories. Annual accounts' spending of the month is `annual_actual`."""
    return summary_service.get_month_detail(db, month, budget_account_id)


@router.get("/summary/annual/{month}", response_model=AnnualSummaryOut)
def annual_summary(
    month: Month,
    principal: SessionPrincipal,
    db: DbSession,
    budget_account_id: int | None = None,
):
    """Year to date (January to the end of `month`) per annual budget account: annual
    budget, actual, actual per month and per category. Every annual account, or one
    (a monthly one is 422 `NOT_ANNUAL_ACCOUNT`)."""
    return summary_service.get_annual_summary(db, month, budget_account_id)
