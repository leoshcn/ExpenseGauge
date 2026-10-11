"""Ledger-wide settings: the base currency, stored in the single `app_settings` row.

Before onboarding sets it there is no row; anything that reports a currency then fails
with `SETTINGS_NOT_INITIALIZED` (409) instead of guessing one.
"""

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import conflict
from app.models import AppSettings
from app.schemas.settings import SettingsOut

SETTINGS_ID = 1


def get_settings(db: Session) -> SettingsOut:
    row = db.get(AppSettings, SETTINGS_ID)
    return SettingsOut(currency=row.currency if row else None)


def require_currency(db: Session) -> str:
    """The base currency, or `SETTINGS_NOT_INITIALIZED` when onboarding has not set it."""
    row = db.get(AppSettings, SETTINGS_ID)
    if row is None:
        raise conflict("SETTINGS_NOT_INITIALIZED", "尚未设置基础币种，请先完成初始设置")
    return row.currency


def update_currency(db: Session, currency: str) -> SettingsOut:
    """Sets the base currency. Only the label changes; stored amounts are not converted."""
    statement = insert(AppSettings).values(id=SETTINGS_ID, currency=currency)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[AppSettings.id], set_={"currency": statement.excluded.currency}
        )
    )
    db.commit()
    return SettingsOut(currency=currency)
