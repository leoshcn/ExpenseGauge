"""Engine and session factory, created lazily so importing the app needs no database."""

from collections.abc import Iterator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import get_settings


class Base(DeclarativeBase):
    pass


@lru_cache
def get_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True)


@lru_cache
def get_sessionmaker() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


MAX_ID = 2**31 - 1  # primary keys are INTEGER columns


def get_by_id[T](db: Session, model: type[T], row_id: int) -> T | None:
    """`db.get` for an id that came from a client. An id no INTEGER column can hold is
    simply absent; sent to PostgreSQL it would fail the statement instead (a 500)."""
    if not 0 < row_id <= MAX_ID:
        return None
    return db.get(model, row_id)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request. Services commit; this only cleans up."""
    with get_sessionmaker()() as session:
        yield session
