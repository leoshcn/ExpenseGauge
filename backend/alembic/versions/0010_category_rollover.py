"""categories.rollover_from: from this month on, a level-2 category's unspent budget (or
overspending) carries into the next month. Additive: every existing category has NULL,
so every figure stays as it was.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-23
"""

import sqlalchemy as sa

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("rollover_from", sa.Date(), nullable=True))
    op.create_check_constraint(
        "ck_categories_rollover_from",
        "categories",
        "rollover_from IS NULL OR (parent_id IS NOT NULL AND EXTRACT(DAY FROM rollover_from) = 1)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_categories_rollover_from", "categories", type_="check")
    op.drop_column("categories", "rollover_from")
