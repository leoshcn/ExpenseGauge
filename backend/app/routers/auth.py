from fastapi import APIRouter, Request, Response

from app.config import get_settings
from app.deps import DbSession, SessionPrincipal, clear_session_cookie, set_session_cookie
from app.schemas.auth import (
    CredentialsIn,
    LoginIn,
    SetupStatus,
    TokenCreatedOut,
    TokenCreateIn,
    TokenOut,
    UserOut,
)
from app.services import auth as auth_service

router = APIRouter()


@router.get("/setup/status", tags=["setup"], response_model=SetupStatus)
def setup_status(db: DbSession):
    return SetupStatus(user_exists=auth_service.user_exists(db))


@router.post("/setup", tags=["setup"], response_model=UserOut, status_code=201)
def setup(payload: CredentialsIn, response: Response, db: DbSession):
    """Creates the only user and signs them in. Returns 409 once a user exists."""
    user = auth_service.create_first_user(db, payload.username, payload.password)
    set_session_cookie(response, auth_service.start_session(db, user))
    return user


@router.post("/auth/login", tags=["auth"], response_model=UserOut)
def login(payload: LoginIn, response: Response, db: DbSession):
    user, value = auth_service.login(db, payload.username, payload.password)
    set_session_cookie(response, value)
    return user


@router.post("/auth/logout", tags=["auth"], status_code=204)
def logout(request: Request, response: Response, db: DbSession):
    auth_service.logout(db, request.cookies.get(get_settings().session_cookie_name))
    clear_session_cookie(response)


@router.get("/auth/me", tags=["auth"], response_model=UserOut)
def me(principal: SessionPrincipal):
    return principal.user


@router.get("/tokens", tags=["tokens"], response_model=list[TokenOut])
def list_tokens(principal: SessionPrincipal, db: DbSession):
    return auth_service.list_tokens(db)


@router.post("/tokens", tags=["tokens"], response_model=TokenCreatedOut, status_code=201)
def create_token(payload: TokenCreateIn, principal: SessionPrincipal, db: DbSession):
    """The raw `token` is in this response only; it cannot be read again."""
    token, raw = auth_service.create_token(db, payload.name)
    return TokenCreatedOut(**TokenOut.model_validate(token).model_dump(), token=raw)


@router.delete("/tokens/{token_id}", tags=["tokens"], status_code=204)
def revoke_token(token_id: int, principal: SessionPrincipal, db: DbSession):
    auth_service.revoke_token(db, token_id)
