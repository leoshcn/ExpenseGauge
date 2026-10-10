# ExpenseGauge

A single-user personal expense manager. Per account, a dashboard compares actual spending
with the budget by category. An AI agent classifies bank transactions and submits them
through the REST API or the MCP server; the app is the source of truth for categories,
budgets and stored transactions.

Status: the backend is implemented. The frontend, Docker Compose deployment and the agent
integration guide are separate, later tasks.

## Layout

| Path | Contents |
|---|---|
| `backend/` | FastAPI app: REST under `/api/v1`, MCP Streamable HTTP under `/mcp` |
| `backend/openapi.json` | Exported API contract, the input for the frontend's typed client |
| `.trellis/` | Task documents and coding conventions (`.trellis/spec/`) |

## Backend

Requires [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 itself) and, to run the
server, a PostgreSQL database.

```bash
cd backend
uv sync                                   # install dependencies
uv run ruff check .                       # lint
uv run ruff format .                      # format
uv run pytest                             # tests
```

### Tests and PostgreSQL

Tests always run against a real PostgreSQL, never SQLite (the code relies on `NUMERIC`
and advisory locks).

- With `TEST_DATABASE_URL` set, that database is used. Its name must contain `test`,
  because the test session drops and recreates its `public` schema.
- Without it, the tests start an embedded PostgreSQL through the `pgserver` dev
  dependency (real server binaries from PyPI; no Docker or system install needed).
  Its data directory is `backend/.pgdata/`, which is git-ignored and safe to delete.

### Running the server

```bash
cd backend
cp ../.env.example .env                   # then edit DATABASE_URL
uv run alembic upgrade head               # create or migrate the schema
uv run uvicorn app.main:app --reload --port 8000
```

- API docs: `http://localhost:8000/api/docs`
- OpenAPI document: `http://localhost:8000/api/openapi.json`
- MCP endpoint: `http://localhost:8000/mcp` (send `Authorization: Bearer eg_...`)

### OpenAPI export

After changing a router or schema, regenerate the contract. It needs neither a running
server nor a database, and a test fails while the file is stale.

```bash
cd backend
uv run python -m scripts.export_openapi   # writes backend/openapi.json
```

### Migrations

```bash
cd backend
uv run alembic revision --autogenerate -m "describe the change"   # needs DATABASE_URL
uv run alembic upgrade head
```

`tests/test_schema.py` fails if the migrations and the models disagree.
