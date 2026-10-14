"""ai_settings (the OpenAI-compatible service for spending insights, one row) and
ai_insights (the last insight generated per month). Additive: no existing data changes.

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-13
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "ai_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("base_url", sa.String(500), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("api_key", sa.Text(), nullable=True),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name="ck_ai_settings_single_row"),
    )
    op.create_table(
        "ai_insights",
        sa.Column("month", sa.Date(), primary_key=True),
        sa.Column("content", postgresql.JSONB(), nullable=False),
        sa.Column("model", sa.String(200), nullable=False),
        sa.Column("data_hash", sa.CHAR(64), nullable=False),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_ai_insights_month_start"),
    )


def downgrade() -> None:
    op.drop_table("ai_insights")
    op.drop_table("ai_settings")
