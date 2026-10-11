from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.settings import SettingsOut, SettingsUpdateIn
from app.services import settings as settings_service

router = APIRouter(tags=["settings"])


@router.get("/settings", response_model=SettingsOut)
def get_settings(principal: SessionPrincipal, db: DbSession):
    """Ledger settings. `currency` is null until onboarding sets it."""
    return settings_service.get_settings(db)


@router.put("/settings", response_model=SettingsOut)
def update_settings(payload: SettingsUpdateIn, principal: SessionPrincipal, db: DbSession):
    """Sets the base currency. Only the label changes; amounts are not converted."""
    return settings_service.update_currency(db, payload.currency)
