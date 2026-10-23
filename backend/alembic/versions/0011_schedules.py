"""schedules: recurring expenses the user expects, to tell whether this period's payment
has arrived and to forecast the month. Additive: no existing data changes.

Revision ID: 0011
Revises: 0010
Create Date: 2026-10-23
"""

import sqlalchemy as sa

from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("keyword", sa.String(100), nullable=False),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("approximate", sa.Boolean(), server_default="false", nullable=False),
        sa.Column("frequency", sa.String(10), nullable=False),
        sa.Column("day", sa.SmallInteger(), nullable=False),
        sa.Column("month_of_year", sa.SmallInteger(), nullable=True),
        sa.Column("start_month", sa.Date(), nullable=False),
        sa.Column("active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("amount > 0", name="ck_schedules_amount_positive"),
        sa.CheckConstraint("frequency IN ('month', 'year')", name="ck_schedules_frequency"),
        sa.CheckConstraint("day = -1 OR day BETWEEN 1 AND 31", name="ck_schedules_day"),
        sa.CheckConstraint(
            "(frequency = 'year') = (month_of_year IS NOT NULL)"
            " AND (month_of_year IS NULL OR month_of_year BETWEEN 1 AND 12)",
            name="ck_schedules_month_of_year",
        ),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM start_month) = 1", name="ck_schedules_start_month_start"
        ),
    )
    op.create_index("ix_schedules_category_id", "schedules", ["category_id"])


def downgrade() -> None:
    op.drop_index("ix_schedules_category_id", table_name="schedules")
    op.drop_table("schedules")
