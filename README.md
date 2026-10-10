# ExpenseGauge

A single-user personal expense manager. Per account, a dashboard compares actual spending
with the budget by category. An AI agent classifies bank transactions and submits them
through the REST API or the MCP server; the app is the source of truth for categories,
budgets and stored transactions.

Status: MVP complete: backend, frontend, Docker Compose deployment and the
[agent integration guide](docs/agent-guide.md).

## Run with Docker Compose

Requires Docker with the Compose plugin. Three services: `web` (nginx: the web UI and a
reverse proxy for `/api` and `/mcp`), `api` (FastAPI + MCP) and `db` (PostgreSQL 16).
Only `web` publishes a port. Plain HTTP for localhost/LAN; there is no built-in HTTPS.

```bash
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD to a random value of letters and digits, e.g. the
# output of `openssl rand -hex 24`. Optionally change WEB_PORT (default 8080).
docker compose up -d --build
docker compose ps                         # all three "healthy" after about 30 s
```

Open `http://<host>:8080`. The `api` container applies database migrations
(`alembic upgrade head`) on every start. Data lives in the named volume
`expense-gauge_db-data`: `docker compose down` keeps it, `docker compose down -v` deletes it.

Keep `SESSION_COOKIE_SECURE=false` while the app is reached over plain HTTP. Set it to
`true` only when an HTTPS reverse proxy is put in front; otherwise the browser drops the
login cookie.

The frontend build inside `docker compose build` needs roughly 1 GB of free memory.

### First-time setup

1. Open the app. With no user yet it shows "create user": choose a username and a
   password (8 characters or more). This page closes for good once the user exists.
2. Onboarding asks for a first account (name and currency, e.g. `CNY`) and at least one
   level-1 category with one level-2 category. Then the Dashboard opens.
3. Add more categories under 设置 → 分类 and budgets on the 预算 page.

### Connecting an agent

1. In the web UI go to 设置 → AI 助手 and click "创建令牌". The token (`eg_...`) is shown
   once; copy it now. Revoke it on the same page when it is no longer needed.
2. The same page shows the MCP address (`http://<host>:8080/mcp`), the account IDs and a
   Hermes Agent config snippet.
3. Follow [`docs/agent-guide.md`](docs/agent-guide.md): workflow, tools, reason codes and
   the single-use `confirm_duplicate` rule.

### Backup and restore

Run from the directory with `docker-compose.yml`. The database user and name are those
in `.env` (`expense_gauge` by default).

```bash
# Backup: plain SQL, safe while the app is running
docker compose exec -T db pg_dump -U expense_gauge -d expense_gauge --clean --if-exists \
  > expense-gauge-$(date +%Y%m%d).sql

# Restore into the running stack (replaces the current data)
docker compose stop web api
docker compose exec -T db psql -U expense_gauge -d expense_gauge -v ON_ERROR_STOP=1 \
  < expense-gauge-20261010.sql
docker compose start api web
```

On a new machine: put the source and a `.env` in place, `docker compose up -d db`, wait
until `docker compose ps` shows it healthy, run the restore command, then
`docker compose up -d --build`.

### Upgrading

```bash
# Back up first (above). Then, with the new source in place:
docker compose up -d --build              # rebuilds the images; api migrates on start
docker image prune -f                     # optional: drop the old image layers
```

Migrations only move forward; to go back to an older version, restore the backup taken
before the upgrade. Changing `POSTGRES_*` in `.env` after the first start does not change
the existing database (PostgreSQL reads them only when its volume is empty).

### Logs

```bash
docker compose logs -f api                # API and migration output
docker compose logs -f web                # nginx access log
docker compose restart                    # restart everything; data is kept
```

## Layout

| Path | Contents |
|---|---|
| `backend/` | FastAPI app: REST under `/api/v1`, MCP Streamable HTTP under `/mcp` |
| `backend/openapi.json` | Exported API contract, the input for the frontend's typed client |
| `frontend/` | React web UI; `frontend/README.md` has the commands to run it with demo data |
| `docs/agent-guide.md` | How an AI agent connects, the three tools and their feedback |
| `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`, `frontend/nginx.conf` | Deployment |

## Backend development

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

For local development without a PostgreSQL install, `scripts/dev_server.py` runs the same
app on an embedded PostgreSQL (data in `backend/.pgdata/dev/`) and `scripts/seed_demo.py`
fills it with demo data through the REST API:

```bash
cd backend
uv run python -m scripts.dev_server --reset   # terminal 1; --reset empties the dev database
uv run python -m scripts.seed_demo            # terminal 2; sign in as demo / expense-gauge-demo
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
