from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.ai import InsightStateOut
from app.schemas.common import Month
from app.services import insights as insight_service

router = APIRouter(tags=["insights"])


@router.get("/insights/{month}", response_model=InsightStateOut)
def get_insight(month: Month, principal: SessionPrincipal, db: DbSession):
    """The month's cached insight, and `stale` when its data changed since it was
    generated. Never calls the model."""
    return insight_service.get_state(db, month)


@router.post("/insights/{month}", response_model=InsightStateOut)
def generate_insight(month: Month, principal: SessionPrincipal, db: DbSession):
    """Sends the month's summaries and transactions to the configured AI service and
    stores the answer. A failure leaves the stored insight unchanged. 409
    `AI_NOT_CONFIGURED`, 502 `AI_PROVIDER_ERROR` / `AI_INVALID_RESPONSE`, 504
    `AI_PROVIDER_TIMEOUT`."""
    return insight_service.generate(db, month)
