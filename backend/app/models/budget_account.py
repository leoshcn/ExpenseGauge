from sqlalchemy import CheckConstraint, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BudgetAccount(Base):
    """A budget pool. Level-2 categories belong to one; budgets and summaries are
    grouped by it. A transaction's budget account follows from its category.

    `period` is `month` (budgets are per month) or `year` (budgets are per calendar year,
    one version per year, effective from January). Chosen at creation, never changed.
    """

    __tablename__ = "budget_accounts"
    __table_args__ = (
        CheckConstraint("period IN ('month', 'year')", name="ck_budget_accounts_period"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    period: Mapped[str] = mapped_column(String(10), server_default="month")
