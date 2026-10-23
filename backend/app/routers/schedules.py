from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.common import Month
from app.schemas.schedule import (
    ScheduleCreateIn,
    ScheduleOut,
    ScheduleStatusOut,
    ScheduleSuggestion,
    ScheduleUpdateIn,
)
from app.services import schedules as schedule_service

router = APIRouter(tags=["schedules"])


@router.get("/schedules", response_model=list[ScheduleOut])
def list_schedules(principal: SessionPrincipal, db: DbSession):
    """Recurring expenses the user expects, active ones first."""
    return schedule_service.list_schedules(db)


@router.post("/schedules", response_model=ScheduleOut, status_code=201)
def create_schedule(payload: ScheduleCreateIn, principal: SessionPrincipal, db: DbSession):
    """A level-2 category; `month_of_year` for a yearly schedule only."""
    return schedule_service.create_schedule(db, payload.model_dump())


@router.get("/schedules/status", response_model=ScheduleStatusOut)
def schedule_status(
    principal: SessionPrincipal,
    db: DbSession,
    month: Month,
    budget_account_id: int | None = None,
):
    """The schedules due in `month`: paid (with the matching payment), pending or overdue;
    and, for the current month, the forecast of the month's spending."""
    return schedule_service.get_status(db, month, budget_account_id)


@router.get("/schedules/suggestions", response_model=list[ScheduleSuggestion])
def schedule_suggestions(principal: SessionPrincipal, db: DbSession):
    """Payments of the last months that look recurring and no schedule covers yet."""
    return schedule_service.suggestions(db)


@router.patch("/schedules/{schedule_id}", response_model=ScheduleOut)
def update_schedule(
    schedule_id: int, payload: ScheduleUpdateIn, principal: SessionPrincipal, db: DbSession
):
    """Partial update; switching to monthly drops `month_of_year`."""
    return schedule_service.update_schedule(db, schedule_id, payload.model_dump(exclude_unset=True))


@router.delete("/schedules/{schedule_id}", status_code=204)
def delete_schedule(schedule_id: int, principal: SessionPrincipal, db: DbSession):
    schedule_service.delete_schedule(db, schedule_id)
