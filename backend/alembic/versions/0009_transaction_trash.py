"""deleted_transactions: deleted rows kept for a week so a delete can be undone.
Additive: no existing data changes.

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-23
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "deleted_transactions",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("data", postgresql.JSONB(), nullable=False),
        sa.Column(
            "deleted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_deleted_transactions_deleted_at", "deleted_transactions", ["deleted_at"])


def downgrade() -> None:
    op.drop_index("ix_deleted_transactions_deleted_at", table_name="deleted_transactions")
    op.drop_table("deleted_transactions")
