"""Split accounts into payment channels and budget accounts; categories become global.

- `app_settings` (single row, id = 1) holds the base currency;
- `budget_accounts`: budget pools; each level-2 category belongs to exactly one;
- `payment_channels`: where a transaction came from; scope of the duplicate check;
- `categories`: one global two-level tree (`account_id` -> `budget_account_id`, level 2 only);
- `transactions`: `account_id` -> `channel_id`.

Business data is NOT migrated (product decision D8): `transactions`, `budgets`,
`categories` and `accounts` are dropped and rebuilt empty. `users`, `sessions` and
`api_tokens` are untouched, so the user stays signed in and agent tokens keep working.

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-11
"""

import sqlalchemy as sa

from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def _drop_business_tables(*names: str) -> None:
    for name in names:
        op.drop_table(name)


def upgrade() -> None:
    # Lossy by design (D8): the old business tables go with their data.
    _drop_business_tables("transactions", "budgets", "categories", "accounts")

    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=False),
        sa.Column("currency", sa.CHAR(3), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_app_settings_single_row"),
    )
    op.create_table(
        "budget_accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
    )
    op.create_table(
        "payment_channels",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
        sa.Column(
            "budget_account_id",
            sa.Integer(),
            sa.ForeignKey("budget_accounts.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.CheckConstraint(
            "parent_id IS NOT NULL OR (budget_account_id IS NULL AND description IS NULL)",
            name="ck_categories_level1_plain",
        ),
        sa.CheckConstraint(
            "parent_id IS NULL OR budget_account_id IS NOT NULL",
            name="ck_categories_level2_budget_account",
        ),
    )
    op.create_index("ix_categories_budget_account_id", "categories", ["budget_account_id"])
    op.create_index(
        "uq_categories_level1_name",
        "categories",
        ["name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )
    op.create_index(
        "uq_categories_level2_name",
        "categories",
        ["parent_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )
    _create_budgets()
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "channel_id",
            sa.Integer(),
            sa.ForeignKey("payment_channels.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        *_transaction_columns(),
    )
    op.create_index("ix_transactions_category_id", "transactions", ["category_id"])
    op.create_index(
        "ix_transactions_channel_fingerprint", "transactions", ["channel_id", "fingerprint"]
    )
    op.create_index("ix_transactions_date", "transactions", ["date"])


def downgrade() -> None:
    # Lossy, like the upgrade: the 0003 tables come back empty.
    _drop_business_tables(
        "transactions", "budgets", "categories", "payment_channels", "budget_accounts"
    )
    op.drop_table("app_settings")

    op.create_table(
        "accounts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(100), nullable=False, unique=True),
        sa.Column("currency", sa.String(3), nullable=False),
    )
    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column(
            "parent_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="RESTRICT"),
            nullable=True,
        ),
        sa.Column("name", sa.String(100), nullable=False),
        sa.Column("description", sa.String(500), nullable=True),
    )
    op.create_index("ix_categories_account_id", "categories", ["account_id"])
    op.create_index(
        "uq_categories_level1_name",
        "categories",
        ["account_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NULL"),
    )
    op.create_index(
        "uq_categories_level2_name",
        "categories",
        ["parent_id", "name"],
        unique=True,
        postgresql_where=sa.text("parent_id IS NOT NULL"),
    )
    _create_budgets()
    op.create_table(
        "transactions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "account_id",
            sa.Integer(),
            sa.ForeignKey("accounts.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        *_transaction_columns(),
    )
    op.create_index("ix_transactions_category_id", "transactions", ["category_id"])
    op.create_index(
        "ix_transactions_account_fingerprint", "transactions", ["account_id", "fingerprint"]
    )
    op.create_index("ix_transactions_account_date", "transactions", ["account_id", "date"])


def _create_budgets() -> None:
    """`budgets` as of 0002 (nullable amount); the same before and after this revision."""
    op.create_table(
        "budgets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("effective_from", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=True),
        sa.UniqueConstraint(
            "category_id", "effective_from", name="uq_budgets_category_effective_from"
        ),
        sa.CheckConstraint("amount >= 0", name="ck_budgets_amount_non_negative"),
        sa.CheckConstraint(
            "EXTRACT(DAY FROM effective_from) = 1", name="ck_budgets_effective_from_month_start"
        ),
    )


def _transaction_columns() -> list[sa.Column | sa.CheckConstraint]:
    """Every `transactions` column except the source (`account_id` / `channel_id`)."""
    return [
        sa.Column(
            "category_id",
            sa.Integer(),
            sa.ForeignKey("categories.id", ondelete="RESTRICT"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("counterparty", sa.String(200), nullable=False),
        sa.Column("description", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("fingerprint", sa.String(64), nullable=False),
        sa.Column("confirmed_duplicate", sa.Boolean(), server_default="false", nullable=False),
        sa.Column(
            "api_token_id",
            sa.Integer(),
            sa.ForeignKey("api_tokens.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.CheckConstraint("amount <> 0", name="ck_transactions_amount_non_zero"),
    ]
