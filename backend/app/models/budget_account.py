from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class BudgetAccount(Base):
    """A budget pool. Level-2 categories belong to one; budgets and summaries are
    grouped by it. A transaction's budget account follows from its category."""

    __tablename__ = "budget_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
