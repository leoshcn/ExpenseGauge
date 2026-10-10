# Directory Structure

> How backend code is organized in this project.

---

## Overview

Three layers with one direction of dependency:

```
routers (HTTP shape) ─┐
                      ├─> services (rules, database transactions) ─> models (SQLAlchemy)
mcp (tool shape) ─────┘
```

- `routers` and `mcp` are thin: parse input, call one service function, return its result.
- `services` own every rule, every query and every `commit`.
- `schemas` (Pydantic) are the contract shared by REST, MCP and the generated OpenAPI.

---

## Directory Layout

```
backend/
├── pyproject.toml            dependencies, pytest and ruff configuration
├── uv.lock
├── alembic.ini
├── alembic/
│   ├── env.py                takes the URL from app.config, metadata from app.db.Base
│   └── versions/             one file per migration: NNNN_description.py
├── openapi.json              exported contract (generated, committed)
├── scripts/
│   └── export_openapi.py     writes openapi.json
├── app/
│   ├── main.py               create_app(): error handlers, routers, /mcp mount, lifespan
│   ├── config.py             Settings (environment variables), get_settings()
│   ├── db.py                 Base, lazy engine, session factory, get_db dependency
│   ├── deps.py               auth dependencies, cookie helpers, JSON-body guard
│   ├── errors.py             AppError and ErrorEnvelope
│   ├── months.py             YYYY-MM parsing and month arithmetic
│   ├── models/               one file per table group; all re-exported in __init__.py
│   ├── schemas/              request/response models; common.py has Money, Month, Name
│   ├── services/             auth, accounts, categories, budgets, transactions,
│   │                         summaries, locks
│   ├── routers/              one APIRouter per resource; __init__.py builds api_router
│   └── mcp/
│       └── server.py         the three tools, Bearer middleware, create_mcp_app()
└── tests/
    ├── conftest.py           PostgreSQL provisioning, clients, the Ledger helper
    └── test_*.py             one file per area
```

---

## Module Organization

Adding a feature means, in this order:

1. **Model** in `app/models/<name>.py`, exported from `app/models/__init__.py`, plus a
   migration in `alembic/versions/`.
2. **Schemas** in `app/schemas/<name>.py`. Request models extend `RequestSchema`
   (unknown fields are rejected); response models extend `Schema`.
3. **Service** functions in `app/services/<name>.py`. Signature convention:
   `def verb_noun(db: Session, ...ids, ...values) -> Model | Schema`. They raise
   `AppError` and commit their own work.
4. **Router** in `app/routers/<name>.py`, added to the tuple in
   `app/routers/__init__.py`. An endpoint body is normally one service call, as in
   `app/routers/budgets.py`.
5. **MCP tool** only if agents need it, in `app/mcp/server.py`, calling the same
   service function (see `submit_transactions` there and `submit_batch` in
   `app/routers/transactions.py`: both call `services.transactions.submit_batch`).
6. **Tests** in `tests/test_<area>.py`, then regenerate `openapi.json`.

Rules that keep the layers honest:

- `app/mcp/` imports from `app/services`, `app/schemas`, `app/db`, `app/errors` and
  the `bearer_value` helper in `app/deps`. It never imports a router.
- Routers never run queries and never import `app.models`.
- A helper used by two services lives in the service that owns the data
  (`get_account` in `services/accounts.py`, `load_categories` and `build_nodes` in
  `services/categories.py`, `BudgetHistory` in `services/budgets.py`).

---

## Naming Conventions

- Files and functions: `snake_case`. Classes: `PascalCase`.
- Tables: plural `snake_case` (`api_tokens`). The ORM class is singular (`ApiToken`).
  The `sessions` table maps to `UserSession` to avoid clashing with SQLAlchemy's `Session`.
- Schemas: `<Thing>Out` for responses, `<Thing><Action>In` for request bodies
  (`AccountCreateIn`, `BudgetsPutIn`).
- Routers import services under an alias: `from app.services import budgets as budget_service`.
- Path parameters are named after the resource: `account_id`, `category_id`,
  `transaction_id`, `token_id`.
- Reason codes: `UPPER_SNAKE_CASE` English.

---

## Examples

- Thin router: `backend/app/routers/categories.py`
- Service with rules and its own commit: `backend/app/services/categories.py`
- One rule shared by REST and MCP: `backend/app/services/transactions.py::submit_batch`
- Aggregation built on shared helpers: `backend/app/services/summaries.py`
