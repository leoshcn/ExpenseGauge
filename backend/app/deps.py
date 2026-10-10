"""FastAPI dependencies: database session, authentication scope, request guards."""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_db
from app.errors import AppError
from app.models import User
from app.services import auth as auth_service

DbSession = Annotated[Session, Depends(get_db)]


@dataclass(frozen=True)
class Principal:
    """Who is calling: the user (session cookie) or an agent (API token)."""

    user: User | None = None
    api_token_id: int | None = None


def bearer_value(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value.strip():
        return None
    return value.strip()


def set_session_cookie(response: Response, value: str) -> None:
    settings = get_settings()
    response.set_cookie(
        settings.session_cookie_name,
        value,
        max_age=settings.session_ttl_days * 24 * 3600,
        httponly=True,
        samesite="lax",
        secure=settings.session_cookie_secure,
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(get_settings().session_cookie_name, path="/")


def _authenticate(
    request: Request, response: Response, db: Session, allow_token: bool
) -> Principal:
    authorization = request.headers.get("authorization")
    if authorization is not None:
        # A request that presents a token is judged as a token, even if a cookie came along.
        token = auth_service.resolve_token(db, bearer_value(authorization))
        if token is None:
            raise AppError(401, "INVALID_TOKEN", "令牌无效或已被吊销")
        if not allow_token:
            raise AppError(
                403,
                "TOKEN_SCOPE_FORBIDDEN",
                "Agent 令牌只能读取分类、读取预算和提交流水",
            )
        return Principal(api_token_id=token.id)

    value = request.cookies.get(get_settings().session_cookie_name)
    session = auth_service.resolve_session(db, value)
    if session is None:
        raise AppError(401, "UNAUTHENTICATED", "未登录或登录已过期")
    if session.refreshed:
        set_session_cookie(response, value)  # sliding expiry
    return Principal(user=session.user)


def require_session(request: Request, response: Response, db: DbSession) -> Principal:
    """Endpoints marked S in the design: session cookie only; an agent token gets 403."""
    return _authenticate(request, response, db, allow_token=False)


def require_session_or_token(request: Request, response: Response, db: DbSession) -> Principal:
    """Endpoints marked S, A in the design. Only the three agent operations use this."""
    return _authenticate(request, response, db, allow_token=True)


SessionPrincipal = Annotated[Principal, Depends(require_session)]
AnyPrincipal = Annotated[Principal, Depends(require_session_or_token)]


def require_json_body(request: Request) -> None:
    """CSRF guard: a state-changing request with a body must be `application/json`."""
    if request.method not in {"POST", "PUT", "PATCH", "DELETE"}:
        return
    content_type = request.headers.get("content-type")
    has_body = request.headers.get("content-length", "0") != "0" or (
        "transfer-encoding" in request.headers
    )
    if content_type is None and not has_body:
        return
    if (content_type or "").split(";")[0].strip().lower() != "application/json":
        raise AppError(415, "UNSUPPORTED_MEDIA_TYPE", "请求体必须是 application/json")
