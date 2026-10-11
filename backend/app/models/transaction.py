from datetime import date, datetime
from decimal import Decimal

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
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Transaction(Base):
    """An expense (amount > 0) or a refund (amount < 0), from one payment channel.

    Its budget account is not stored: it is the budget account of its category.
    """

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="ck_transactions_amount_non_zero"),
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
