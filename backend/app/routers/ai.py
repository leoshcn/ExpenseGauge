from fastapi import APIRouter

from app.deps import DbSession, SessionPrincipal
from app.schemas.ai import AiSettingsOut, AiSettingsUpdateIn, AiTestOut
from app.services import ai_client
from app.services import ai_settings as ai_settings_service

router = APIRouter(tags=["ai"])


@router.get("/ai/settings", response_model=AiSettingsOut)
def get_ai_settings(principal: SessionPrincipal, db: DbSession):
    """The OpenAI-compatible service used for insights. The API key is never returned:
    only whether one is set and its last 4 characters."""
    return ai_settings_service.get_ai_settings(db)


@router.put("/ai/settings", response_model=AiSettingsOut)
def update_ai_settings(payload: AiSettingsUpdateIn, principal: SessionPrincipal, db: DbSession):
    """Saves base URL and model. `api_key` omitted keeps the stored key, a string
    replaces it, `null` clears it."""
    return ai_settings_service.update_ai_settings(db, payload)


@router.post("/ai/settings/test", response_model=AiTestOut)
def test_ai_settings(principal: SessionPrincipal, db: DbSession):
    """Sends one minimal chat request with the saved configuration; returns the latency.
    409 `AI_NOT_CONFIGURED`, 502 `AI_PROVIDER_ERROR` / `AI_INVALID_RESPONSE`, 504
    `AI_PROVIDER_TIMEOUT`."""
    return ai_client.check_connection(db)
