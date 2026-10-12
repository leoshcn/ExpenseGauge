"""categories.position: display order among siblings. Existing categories keep their
order (by id).

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-12
"""

import sqlalchemy as sa

from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("categories", sa.Column("position", sa.Integer(), nullable=True))
    # PARTITION BY puts every NULL parent_id in one group, so level 1 is numbered together.
    op.execute(
        "UPDATE categories SET position = ranked.position FROM ("
        " SELECT id, ROW_NUMBER() OVER (PARTITION BY parent_id ORDER BY id) - 1 AS position"
        " FROM categories) AS ranked WHERE categories.id = ranked.id"
    )
    op.alter_column("categories", "position", nullable=False)


def downgrade() -> None:
    # Lossy: the custom order is gone and categories are listed by id again.
    op.drop_column("categories", "position")
