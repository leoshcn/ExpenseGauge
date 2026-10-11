from sqlalchemy import CheckConstraint, ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Category(Base):
    """One global two-level tree: `parent_id IS NULL` is level 1, otherwise level 2.

    Each level-2 category belongs to exactly one budget account; level 1 belongs to none
    and has no description. Name uniqueness is two partial unique indexes: level-1 names
    are unique globally, level-2 names per parent (a plain unique(parent_id, name) would
    allow duplicate level-1 names because PostgreSQL treats NULLs as distinct).
    """

    __tablename__ = "categories"
    __table_args__ = (
        Index(
            "uq_categories_level1_name",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NULL"),
        ),
        Index(
            "uq_categories_level2_name",
            "parent_id",
            "name",
            unique=True,
            postgresql_where=text("parent_id IS NOT NULL"),
        ),
        CheckConstraint(
            "parent_id IS NOT NULL OR (budget_account_id IS NULL AND description IS NULL)",
            name="ck_categories_level1_plain",
        ),
        CheckConstraint(
            "parent_id IS NULL OR budget_account_id IS NOT NULL",
            name="ck_categories_level2_budget_account",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(100))
    # What belongs (or does not) in a level-2 category, for the agent that classifies
    # transactions. Level-1 rows always have NULL here.
    description: Mapped[str | None] = mapped_column(String(500))
    # Level 2 only. Changing it moves the category's whole history (no versioning).
    budget_account_id: Mapped[int | None] = mapped_column(
        ForeignKey("budget_accounts.id", ondelete="RESTRICT"), index=True
    )
