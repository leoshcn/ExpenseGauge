# Database Guidelines

> Database patterns and conventions for this project.

---

## Overview

- PostgreSQL only. The code depends on `NUMERIC`, partial unique indexes,
  `INSERT ... ON CONFLICT` and advisory locks; SQLite is not supported, in tests either.
- SQLAlchemy 2.x, synchronous, typed models (`Mapped[...]`, `mapped_column`) on
  `app.db.Base`. Driver: psycopg 3. `app/config.py` rewrites `postgresql://` to
  `postgresql+psycopg://`, so either form works in `DATABASE_URL`.
- The engine is created lazily (`app/db.py::get_engine`), so importing `app.main`
  (for example to export OpenAPI) needs no database.
- One session per request from the `get_db` dependency (`DbSession` in `app/deps.py`).
  MCP tools open their own session per call through `_run` in `app/mcp/server.py`.
- The session factory uses `expire_on_commit=False`: objects stay readable after the
  service commits, which is what lets a router return an ORM object.

### Transactions

- **Services commit.** A write service ends with `db.commit()`. Routers, dependencies
  and MCP tools never commit or roll back.
- A service that must be atomic does all its checks first and commits once
  (`services/budgets.py::set_budgets`, `services/transactions.py::submit_batch`).
- A uniqueness violation is caught at commit and turned into an `AppError`, with a
  rollback first (`_commit_name` in `services/accounts.py` and `services/categories.py`).

### Advisory locks

`app/services/locks.py` holds every lock. They are transaction-scoped
(`pg_advisory_xact_lock(namespace, id)`) and released by commit or rollback.

| Function | Key | Protects |
|---|---|---|
| `lock_setup` | `(1001, 0)` | "at most one user" check + insert |
| `lock_account_transactions` | `(1002, account_id)` | a batch's duplicate check + insert |

`submit_batch` takes the account lock before it reads anything it bases a decision on,
and keeps it until its single commit or rollback. That is what stops two concurrent
batches from both passing the duplicate check; `tests/test_concurrency.py` proves it.
Anything else that inserts transactions for an account must take the same lock.

---

## Query Patterns

- 2.x style only: `db.scalars(select(Model).where(...))`, `db.scalar(...)`,
  `db.get(Model, id)`. No legacy `db.query`.
- An id that came from a client (path, body, MCP argument) is looked up with
  `app/db.py::get_by_id(db, Model, id)`, not `db.get`: an id beyond `INTEGER` makes
  PostgreSQL fail the statement (a 500), while `get_by_id` returns `None` so the caller
  raises its usual "not found" (`get_account`, `get_category`, `revoke_token`).
- Load small per-account sets once and work in Python instead of querying per row:
  `load_categories` (all categories of an account) and `load_history` (all budget
  versions of an account) are reused by budgets, transactions and summaries.
- **Budget in force**: the version with the greatest `effective_from <= month`.
  `services/budgets.py::BudgetHistory` is the only implementation; the single-month
  endpoint, the 12-month series and the MCP `get_budgets` tool all use it. Amount 0 is a
  real budget. "No budget" (returned as `null`, with `effective_from: null`) means no
  version at all, or the version in force has a NULL `amount`: a budget cleared from that
  month (`PUT budgets` with `"amount": null`). `in_force` hides cleared versions, so
  callers never see a NULL amount row. A level-1 budget sums only children that have a
  budget and is `null` when none has (`services/summaries.py::_sum_or_none`).
- Clearing where no budget is in force before that month stores no version (it only
  deletes a version at that same month, if any), so redundant clearing rows do not pile
  up (`set_budgets`, `BudgetHistory.in_force_before`).
- Aggregates are done in SQL (`func.sum`, `GROUP BY`) and returned as `Decimal`.
- Upserts use `sqlalchemy.dialects.postgresql.insert(...).on_conflict_do_update`,
  naming the constraint (`set_budgets`).
- Existence checks use `select(exists().where(...))`.
- Raw SQL appears only for advisory locks and in tests.

### Money

- Columns are `NUMERIC(14, 2)`, Python type `Decimal`, never `float`.
- In JSON, money is a decimal string with two places (`"35.50"`). The `Money` type in
  `app/schemas/common.py` enforces at most 14 digits and 2 decimal places on input.
- Quantize to cents before building a response from a not-yet-reloaded object
  (`CENT` in `services/transactions.py`), so the response equals what is stored.
- Expense is positive, refund is negative, zero is rejected (check constraint and schema).

### Months

- Over the API a month is the string `YYYY-MM` (the `Month` type). In the database it
  is a `DATE` holding the first day (`budgets.effective_from`, with a check constraint).
- Convert only with `app/months.py` (`parse_month`, `format_month`, `add_months`,
  `months_between`). A transaction belongs to the month of its `date`; month filters
  are half-open ranges: `date >= start AND date < add_months(start, 1)`.

### Fingerprint

`services/transactions.py::compute_fingerprint` is sha256 of
`account_id|date|amount (2 dp)|norm(counterparty)|norm(description)`, where `norm` is
NFKC, trim, collapse whitespace, casefold. It is computed by the server only and never
returned by the API. The index on `(account_id, fingerprint)` is deliberately not unique:
user-confirmed duplicates are legitimate rows.

---

## Migrations

- Alembic, in `backend/alembic/`. `env.py` reads the URL from `app.config` and the
  metadata from `app.db.Base`; `alembic.ini` contains no URL.
- Files are named `NNNN_description.py` with revision id `NNNN` (`0001_initial_schema.py`).
- Create: `uv run alembic revision --autogenerate -m "..."` (needs `DATABASE_URL`), then
  read and edit the result. Apply: `uv run alembic upgrade head`.
- Every migration has a working `downgrade`. A migration is never edited once committed;
  changes go into a new revision (`0002_budget_amount_nullable.py` makes
  `budgets.amount` nullable; its downgrade deletes the clearing rows, which the old
  schema cannot hold).
- A migration that changes existing data or constraints gets a test that upgrades from
  the previous revision with rows present
  (`tests/test_schema.py::test_0002_applies_to_a_database_that_already_has_budgets`,
  using `tests/conftest.py::alembic_config`).
- `tests/test_schema.py::test_migrations_match_models` compares the migrated database
  with the models and fails on any difference. The test database itself is built by
  running the migrations, never by `Base.metadata.create_all`.

---

## Naming Conventions

- Tables plural `snake_case`; columns `snake_case`; primary key `id` (integer identity),
  except `sessions.id`, which is the SHA-256 of the cookie value.
- Foreign keys are `<table_singular>_id` with an explicit `ondelete`: `RESTRICT` for
  data that must not vanish (transactions -> categories, categories -> accounts),
  `CASCADE` for owned rows (budgets -> categories, sessions -> users), `SET NULL` for
  provenance (transactions.api_token_id).
- Explicit names: `uq_<table>_<what>` unique, `ck_<table>_<what>` check,
  `ix_<table>_<columns>` index.
- Timestamps are `DateTime(timezone=True)` with `server_default=func.now()`.

---

## Common Mistakes

- **Relying on `UNIQUE(account_id, parent_id, name)` for level-1 categories.**
  PostgreSQL treats NULLs as distinct, so it would allow duplicate level-1 names. The
  model uses two partial unique indexes instead (`app/models/category.py`).
- **Returning a `Decimal` exactly as it was submitted.** `"100"` and the stored
  `100.00` serialize differently; quantize first.
- **`date_trunc('month', date_column)` returns a timestamp**, time zone dependent.
  Cast it back to `Date` before using it as a key (`services/summaries.py`).
- **Checking for duplicates before taking the account lock.** The check then reads a
  state another batch is about to change.
- **Storing a client string without the `NoNul` validator.** PostgreSQL text cannot
  hold U+0000; the INSERT fails and the caller gets a 500. Every stored string type in
  `app/schemas/` carries `NoNul` from `app/schemas/common.py` (`Name`, `Username`,
  the transaction text fields).
- **Month arithmetic at the ends of the calendar.** `add_months` raises
  `INVALID_MONTH` (422) instead of overflowing `date` for `9999-12` + 1 or `0001-01` - 1.
- **Starting a `TestClient` as a context manager in tests.** That runs the app
  lifespan, and the MCP session manager can be started only once per app instance.
  Use `create_app()` for a fresh app when a test needs the lifespan (`tests/test_mcp.py`).
