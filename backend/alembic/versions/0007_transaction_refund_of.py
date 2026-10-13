"""transactions.refund_of_id: the payment a refund reverses. Existing transactions stay
unmatched, so every summary reads as before.

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-12
"""

import sqlalchemy as sa

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "transactions",
        sa.Column(
            "refund_of_id",
            sa.Integer(),
            sa.ForeignKey("transactions.id", ondelete="RESTRICT"),
            nullable=True,
        ),
    )
    op.create_index("ix_transactions_refund_of_id", "transactions", ["refund_of_id"])
    op.create_check_constraint(
        "ck_transactions_refund_of_is_refund",
        "transactions",
        "refund_of_id IS NULL OR amount < 0",
    )


def downgrade() -> None:
    # Lossy: the matches are gone and every refund counts in its own month and category again.
    op.drop_constraint("ck_transactions_refund_of_is_refund", "transactions", type_="check")
    op.drop_index("ix_transactions_refund_of_id", table_name="transactions")
    op.drop_column("transactions", "refund_of_id")
