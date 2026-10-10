from typing import Annotated

from fastapi import APIRouter, Query

from app.deps import DbSession, SessionPrincipal
from app.schemas.common import Month
from app.schemas.summary import MonthDetailOut, MonthlySummaryOut
from app.services import summaries as summary_service

router = APIRouter(tags=["summary"])


@router.get("/accounts/{account_id}/summary/monthly", response_model=MonthlySummaryOut)
def monthly_summary(
    account_id: int,
    principal: SessionPrincipal,
    db: DbSession,
    from_month: Annotated[Month | None, Query(alias="from")] = None,
    to_month: Annotated[Month | None, Query(alias="to")] = None,
):
    """Per month: total budget and total actual. Defaults to the 12 months ending at `to`."""
    return summary_service.get_monthly_summary(db, account_id, from_month, to_month)


@router.get("/accounts/{account_id}/summary/months/{month}", response_model=MonthDetailOut)
def month_detail(account_id: int, month: Month, principal: SessionPrincipal, db: DbSession):
    """Level-1 rows with nested level-2 rows: budget and actual."""
    return summary_service.get_month_detail(db, account_id, month)
