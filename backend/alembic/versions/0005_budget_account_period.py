"""budget_accounts.period: 'month' or 'year'. Existing budget accounts become monthly.

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-11
"""

import sqlalchemy as sa

from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "budget_accounts",
        sa.Column("period", sa.String(length=10), server_default="month", nullable=False),
    )
    op.create_check_constraint(
        "ck_budget_accounts_period", "budget_accounts", "period IN ('month', 'year')"
    )


def downgrade() -> None:
    # Lossy for the period only: annual budget versions would then read as monthly ones.
    op.drop_constraint("ck_budget_accounts_period", "budget_accounts", type_="check")
    op.drop_column("budget_accounts", "period")
