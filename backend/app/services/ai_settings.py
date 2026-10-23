"""The OpenAI-compatible service that writes spending insights, in the single
`ai_settings` row.

The API key is write-only: it is stored as given, used only in the `Authorization`
header of the outgoing request, and never returned or logged. Responses say whether a key
is set and show its last four characters.
"""

from dataclasses import dataclass

from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import conflict
from app.models import AiSettings
from app.schemas.ai import AiSettingsOut, AiSettingsUpdateIn

SETTINGS_ID = 1
# Below this length the last four characters would give most of the key away.
HINT_MIN_LENGTH = 8


@dataclass(frozen=True)
class AiConfig:
    base_url: str
    model: str
    api_key: str | None

    def __repr__(self) -> str:  # never print the key, not even in a traceback
        return f"AiConfig(base_url={self.base_url!r}, model={self.model!r})"


def _out(row: AiSettings | None) -> AiSettingsOut:
    if row is None:
        return AiSettingsOut(
            base_url=None, model=None, api_key_set=False, api_key_hint=None, configured=False
        )
    key = row.api_key
    return AiSettingsOut(
        base_url=row.base_url,
        model=row.model,
        api_key_set=key is not None,
        api_key_hint=key[-4:] if key is not None and len(key) >= HINT_MIN_LENGTH else None,
        configured=True,
    )


def get_ai_settings(db: Session) -> AiSettingsOut:
    return _out(db.get(AiSettings, SETTINGS_ID))


def is_configured(db: Session) -> bool:
    return db.get(AiSettings, SETTINGS_ID) is not None


def update_ai_settings(db: Session, payload: AiSettingsUpdateIn) -> AiSettingsOut:
    """Saves base URL and model. `api_key` omitted keeps the stored key (none on the first
    save), a string replaces it, `null` clears it."""
    values = {"base_url": payload.base_url, "model": payload.model, "updated_at": func.now()}
    if "api_key" in payload.model_fields_set:
        values["api_key"] = payload.api_key
    statement = insert(AiSettings).values(id=SETTINGS_ID, **values)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[AiSettings.id],
            set_={name: statement.excluded[name] for name in values},
        )
    )
    db.commit()
    db.expire_all()
    return get_ai_settings(db)


def require_config(db: Session) -> AiConfig:
    """The saved service, or `AI_NOT_CONFIGURED` (409) when there is none."""
    row = db.get(AiSettings, SETTINGS_ID)
    if row is None:
        raise conflict("AI_NOT_CONFIGURED", "尚未配置 AI 服务，请先在设置中填写 Base URL 和模型")
    return AiConfig(base_url=row.base_url, model=row.model, api_key=row.api_key)
