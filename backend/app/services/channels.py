"""Payment channels: where transactions come from, and the scope of the duplicate
check. They play no part in budgets or summaries. No delete."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import AppError, conflict
from app.models import PaymentChannel


def get_channel(db: Session, channel_id: int, status_code: int = 404) -> PaymentChannel:
    """404 when the channel is the URL's resource; pass 422 when the id is a value
    inside the request (a query filter)."""
    channel = get_by_id(db, PaymentChannel, channel_id)
    if channel is None:
        raise AppError(
            status_code,
            "CHANNEL_NOT_FOUND",
            "付款渠道不存在",
            {"channel_id": channel_id} if status_code != 404 else None,
        )
    return channel


def list_channels(db: Session) -> list[PaymentChannel]:
    return list(db.scalars(select(PaymentChannel).order_by(PaymentChannel.id)))


def channel_names(db: Session) -> dict[int, str]:
    return {row.id: row.name for row in list_channels(db)}


def _commit_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("CHANNEL_NAME_TAKEN", "已存在同名付款渠道") from exc


def create_channel(db: Session, name: str) -> PaymentChannel:
    channel = PaymentChannel(name=name)
    db.add(channel)
    _commit_name(db)
    return channel


def rename_channel(db: Session, channel_id: int, name: str) -> PaymentChannel:
    channel = get_channel(db, channel_id)
    channel.name = name
    _commit_name(db)
    return channel
