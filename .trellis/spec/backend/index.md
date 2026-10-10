# Backend Development Guidelines

> Conventions of the ExpenseGauge backend (`backend/`), written from the code as it is.

---

## Overview

One FastAPI process serves the REST API under `/api/v1` and an MCP Streamable HTTP app
mounted at `/mcp`. Both call the same service functions; every rule lives in
`backend/app/services/`.

Stack: Python 3.12 managed by `uv`, FastAPI, SQLAlchemy 2.x (sync) with psycopg 3,
Alembic, Pydantic v2, the official `mcp` SDK (2.x), pytest, ruff. Database: PostgreSQL.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Layers, where code goes, naming | Filled |
| [Database Guidelines](./database-guidelines.md) | Models, transactions, locks, migrations, money, months | Filled |
| [Error Handling](./error-handling.md) | `AppError`, the error envelope, reason codes, batch feedback | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Lint, tests, auth scope rules, review checklist | Filled |
| [Logging Guidelines](./logging-guidelines.md) | What is logged and what never is | Filled |

---

## Pre-Development Checklist

Before changing the backend, read:

1. [Directory Structure](./directory-structure.md) - always.
2. [Error Handling](./error-handling.md) - when adding or changing an endpoint, tool or rule.
3. [Database Guidelines](./database-guidelines.md) - when touching models, queries or migrations.
4. [Quality Guidelines](./quality-guidelines.md) - before running the checks and before review.
5. `../guides/cross-layer-thinking-guide.md` - when a response shape changes, because
   the frontend client is generated from `backend/openapi.json`.

## Commands

```bash
cd backend
uv run ruff check .                       # lint
uv run ruff format .                      # format
uv run pytest                             # tests, real PostgreSQL
uv run python -m scripts.export_openapi   # regenerate backend/openapi.json
```

---

**Language**: documentation, code, field names and reason codes are English. Every
user-facing `message` returned by the API is Simplified Chinese.
