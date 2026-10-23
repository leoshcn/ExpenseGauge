from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Numeric,
    SmallInteger,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Schedule(Base):
    """A recurring expense the user expects (rent, a subscription): used to say whether
    this period's payment has arrived, and to forecast the month. Never creates a
    transaction; transactions still come only from the agent (`services/schedules.py`).

    `day` is the day of the month, or -1 for the last day; a day beyond the month's length
    means its last day. A yearly schedule is due in `month_of_year` only.
    """

    __tablename__ = "schedules"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_schedules_amount_positive"),
        CheckConstraint("frequency IN ('month', 'year')", name="ck_schedules_frequency"),
        CheckConstraint("day = -1 OR day BETWEEN 1 AND 31", name="ck_schedules_day"),
        CheckConstraint(
            "(frequency = 'year') = (month_of_year IS NOT NULL)"
            " AND (month_of_year IS NULL OR month_of_year BETWEEN 1 AND 12)",
            name="ck_schedules_month_of_year",
        ),
        CheckConstraint("EXTRACT(DAY FROM start_month) = 1", name="ck_schedules_start_month_start"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    # Matched, case-insensitively, against a payment's counterparty or description.
    keyword: Mapped[str] = mapped_column(String(100))
    category_id: Mapped[int] = mapped_column(
        ForeignKey("categories.id", ondelete="RESTRICT"), index=True
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
    # Within 7.5% of `amount` rather than equal.
    approximate: Mapped[bool] = mapped_column(Boolean, server_default="false")
    frequency: Mapped[str] = mapped_column(String(10))
    day: Mapped[int] = mapped_column(SmallInteger)
    month_of_year: Mapped[int | None] = mapped_column(SmallInteger)
    start_month: Mapped[date] = mapped_column(Date)
    active: Mapped[bool] = mapped_column(Boolean, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
