from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.common import Month
from app.schemas.report import (
    DailyOut,
    GroupBy,
    ReportOut,
    SavedReportIn,
    SavedReportOut,
    SavedReportUpdateIn,
)
from app.services import reports as report_service

router = APIRouter(tags=["reports"])


@router.get("/reports/summary", response_model=ReportOut)
def report_summary(
    principal: SessionPrincipal,
    db: DbSession,
    group_by: GroupBy,
    from_month: Month,
    to_month: Month,
    budget_account_id: int | None = None,
):
    """Net amount and consumption count per group (level-1 or level-2 category,
    counterparty, channel or tag) and per month, inclusive, at most 60 months. A matched
    refund counts with its payment; with tags, a transaction is in each of its tags."""
    return report_service.summarize(db, group_by, from_month, to_month, budget_account_id)


@router.get("/reports/daily", response_model=DailyOut)
def report_daily(
    principal: SessionPrincipal,
    db: DbSession,
    from_month: Month,
    to_month: Month,
    budget_account_id: int | None = None,
):
    """Net amount per day and the monthly budget per month; without a budget account,
    the monthly budget accounts only (the dashboard's "全部")."""
    return report_service.daily(db, from_month, to_month, budget_account_id)


@router.get("/reports/saved", response_model=list[SavedReportOut])
def list_saved_reports(principal: SessionPrincipal, db: DbSession):
    return report_service.list_saved(db)


@router.post("/reports/saved", response_model=SavedReportOut, status_code=201)
def save_report(payload: SavedReportIn, principal: SessionPrincipal, db: DbSession):
    return report_service.save(db, payload.name, payload.config)


@router.patch("/reports/saved/{report_id}", response_model=SavedReportOut)
def update_saved_report(
    report_id: int, payload: SavedReportUpdateIn, principal: SessionPrincipal, db: DbSession
):
    """Rename and/or overwrite the settings."""
    return report_service.update_saved(db, report_id, payload.name, payload.config)


@router.delete("/reports/saved/{report_id}", status_code=204)
def delete_saved_report(report_id: int, principal: SessionPrincipal, db: DbSession):
    report_service.delete_saved(db, report_id)
