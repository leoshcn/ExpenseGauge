"""budgets.amount becomes nullable: a NULL amount is a cleared budget ("no budget" from
that month on).

`ck_budgets_amount_non_negative` (`amount >= 0`) is left as it is: a check constraint
passes when its expression is NULL.

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-10
"""

import sqlalchemy as sa

from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("budgets", "amount", existing_type=sa.Numeric(14, 2), nullable=True)


def downgrade() -> None:
    # Lossy: the old schema cannot express "cleared". Dropping the clearing rows lets the
    # amount that was in force before them reach forward again.
    op.execute("DELETE FROM budgets WHERE amount IS NULL")
    op.alter_column("budgets", "amount", existing_type=sa.Numeric(14, 2), nullable=False)
