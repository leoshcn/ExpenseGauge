from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Transaction(Base):
    """An expense (amount > 0) or a refund (amount < 0), from one payment channel.

    Its budget account is not stored: it is the budget account of its category.

    A refund may point at the payment it reverses (`refund_of_id`). Summaries then count
    it in the payment's month and category; its own `date` and `category_id` stay as
    submitted and apply again when the match is removed. The rules a CHECK cannot express
    (the target is a payment, not dated after the refund, not refunded beyond its amount)
    are enforced by `services/refunds.py`.
    """

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="ck_transactions_amount_non_zero"),
        CheckConstraint(
            "refund_of_id IS NULL OR amount < 0", name="ck_transactions_refund_of_is_refund"
        ),
        # Not unique: user-confirmed duplicates are legitimate rows.
        Index("ix_transactions_channel_fingerprint", "channel_id", "fingerprint"),
        Index("ix_transactions_date", "date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    channel_id: Mapped[int] = mapped_column(ForeignKey("payment_channels.id", ondelete="RESTRICT"))
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    date: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    counterparty: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)
    note: Mapped[str | None] = mapped_column(Text)
    fingerprint: Mapped[str] = mapped_column(String(64))
    confirmed_duplicate: Mapped[bool] = mapped_column(Boolean, server_default="false")
    api_token_id: Mapped[int | None] = mapped_column(
        ForeignKey("api_tokens.id", ondelete="SET NULL")
    )
    refund_of_id: Mapped[int | None] = mapped_column(
        ForeignKey("transactions.id", ondelete="RESTRICT"), index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class DeletedTransaction(Base):
    """A deleted transaction, kept so the user can undo the delete: every column of the row
    as JSON (`services/transaction_trash.py::snapshot`), under its original id. Rows older
    than a week are purged on the next delete; restoring removes the row."""

    __tablename__ = "deleted_transactions"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
