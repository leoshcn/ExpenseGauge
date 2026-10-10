from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Numeric, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Budget(Base):
    """One version of a level-2 category's monthly budget, in force from `effective_from`."""

    __tablename__ = "budgets"
    __table_args__ = (
        UniqueConstraint(
            "category_id", "effective_from", name="uq_budgets_category_effective_from"
        ),
        CheckConstraint("amount >= 0", name="ck_budgets_amount_non_negative"),
        CheckConstraint(
            "EXTRACT(DAY FROM effective_from) = 1", name="ck_budgets_effective_from_month_start"
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id", ondelete="CASCADE"))
    effective_from: Mapped[date] = mapped_column(Date)
    amount: Mapped[Decimal] = mapped_column(Numeric(14, 2))
