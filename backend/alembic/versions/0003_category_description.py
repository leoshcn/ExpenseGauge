"""categories.description: optional user-written note on a level-2 category, read by the
agent when classifying. Existing rows get NULL.

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-11
"""

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("description", sa.String(length=500), nullable=True))


def downgrade() -> None:
    # Lossy: the descriptions are dropped with the column.
    op.drop_column("categories", "description")
