from sqlalchemy import ForeignKey, Index, String, text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class Category(Base):
    """Two levels per account: `parent_id IS NULL` is level 1, otherwise level 2.

    Name uniqueness is two partial unique indexes because PostgreSQL treats NULLs
    as distinct in a plain unique(account_id, parent_id, name).
    """

    __tablename__ = "categories"
    __table_args__ = (
        Index(
            "uq_categories_level1_name",
            "account_id",
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
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="RESTRICT"), index=True
    )
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(100))
