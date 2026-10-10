"""User setup, sessions and agent tokens."""

import hashlib
import secrets
import time
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import get_settings
from app.db import get_by_id
from app.errors import AppError, conflict, not_found
from app.models import ApiToken, User, UserSession
from app.services.locks import lock_setup

TOKEN_PREFIX = "eg_"
# A session's expiry is pushed out once it has used up this much of its lifetime.
_SESSION_REFRESH_AFTER = timedelta(days=1)

_hasher = PasswordHasher()


@dataclass(frozen=True)
class SessionAuth:
    user: User
    # True when the expiry was extended and the cookie should be re-sent.
    refreshed: bool


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _now() -> datetime:
    return datetime.now(UTC)


def _session_ttl() -> timedelta:
    return timedelta(days=get_settings().session_ttl_days)


def user_exists(db: Session) -> bool:
    return db.scalar(select(func.count()).select_from(User)) > 0


def create_first_user(db: Session, username: str, password: str) -> User:
    lock_setup(db)
    if user_exists(db):
        raise conflict("USER_ALREADY_EXISTS", "用户已存在，无法再次创建")
    user = User(username=username, password_hash=_hasher.hash(password))
    db.add(user)
    db.commit()
    return user


def start_session(db: Session, user: User) -> str:
    """Creates a session and returns the raw value for the cookie; only its hash is stored."""
    value = secrets.token_urlsafe(32)  # 256 random bits
    db.add(UserSession(id=_sha256(value), user_id=user.id, expires_at=_now() + _session_ttl()))
    db.commit()
    return value


def login(db: Session, username: str, password: str) -> tuple[User, str]:
    user = db.scalar(select(User).where(User.username == username.strip()))
    ok = False
    if user is not None:
        try:
            ok = _hasher.verify(user.password_hash, password)
        except (VerificationError, InvalidHashError):
            ok = False
    if not ok or user is None:
        # Basic guard: every failed attempt costs a fixed delay.
        time.sleep(get_settings().login_failure_delay_seconds)
        raise AppError(401, "INVALID_CREDENTIALS", "用户名或密码错误")
    return user, start_session(db, user)


def resolve_session(db: Session, value: str | None) -> SessionAuth | None:
    if not value:
        return None
    session = db.get(UserSession, _sha256(value))
    if session is None:
        return None
    now = _now()
    if session.expires_at <= now:
        db.delete(session)
        db.commit()
        return None
    user = db.get(User, session.user_id)
    if user is None:
        return None
    refreshed = False
    if session.expires_at - now < _session_ttl() - _SESSION_REFRESH_AFTER:
        session.expires_at = now + _session_ttl()
        db.commit()
        refreshed = True
    return SessionAuth(user=user, refreshed=refreshed)


def logout(db: Session, value: str | None) -> None:
    if not value:
        return
    session = db.get(UserSession, _sha256(value))
    if session is not None:
        db.delete(session)
        db.commit()


def list_tokens(db: Session) -> list[ApiToken]:
    return list(db.scalars(select(ApiToken).order_by(ApiToken.id)))


def create_token(db: Session, name: str) -> tuple[ApiToken, str]:
    """Returns the row and the raw token. The raw token exists only in this return value."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    token = ApiToken(name=name, token_hash=_sha256(raw))
    db.add(token)
    db.commit()
    return token, raw


def revoke_token(db: Session, token_id: int) -> None:
    token = get_by_id(db, ApiToken, token_id)
    if token is None:
        raise not_found("TOKEN_NOT_FOUND", "令牌不存在")
    if token.revoked_at is None:
        token.revoked_at = _now()
        db.commit()


def resolve_token(db: Session, raw: str | None) -> ApiToken | None:
    """Returns the live token for a raw bearer value, recording its use."""
    if not raw or not raw.startswith(TOKEN_PREFIX):
        return None
    token = db.scalar(select(ApiToken).where(ApiToken.token_hash == _sha256(raw)))
    if token is None or token.revoked_at is not None:
        return None
    token.last_used_at = _now()
    db.commit()
    return token
