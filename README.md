# ExpenseGauge

A single-user personal expense manager. A dashboard compares actual spending with the
budget by category, for all budget accounts together or one at a time. An AI agent
classifies bank transactions and submits them per payment channel through the REST API
or the MCP server; the app is the source of truth for channels, categories, budgets and
stored transactions.

Three concepts: a **payment channel** (付款渠道) is where transactions come from (a card,
a statement) and only scopes duplicate detection; a **category** (分类) is a global
two-level tree of what money is spent on; a **budget account** (预算账户) is a budget pool,
and every level-2 category belongs to one, so a transaction counts towards the budget
account of its category whichever channel paid it. A budget account is either monthly
(budgets per month, compared month by month) or annual (one budget per calendar year,
compared with the spending from January to date, e.g. insurance or holidays); the period
is chosen when the account is created. All amounts are in one base currency.

Expenses are positive, refunds negative. A refund can be **matched** to the payment it
reverses (by the agent when it submits it, or by the user on the Transactions page); it
then reduces that payment's month and category, and a fully refunded payment no longer
counts as a consumption (消费笔数). An unmatched refund counts in its own month and
category.

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
2. Onboarding has three steps:
   1. the base currency (e.g. `CNY`) and a first budget account (e.g. `日常`);
   2. categories: at least one level-1 category with one level-2 category; each level-2
      category picks its budget account (the first one by default). More budget accounts
      (e.g. `固定`) can be added from this step;
   3. a first payment channel (e.g. `储蓄卡`). Then the Dashboard opens.
3. Add more budget accounts and channels under 设置 → 账本, more categories (or move a
   level-2 category to another budget account) under 设置 → 分类, and budgets on the 预算
   page. The base currency can be changed under 设置 → 账本; this only relabels amounts,
   nothing is converted.

### Connecting an agent

1. In the web UI go to 设置 → AI 助手 and click "创建令牌". The token (`eg_...`) is shown
   once; copy it now. Revoke it on the same page when it is no longer needed.
2. The same page shows the MCP address (`http://<host>:8080/mcp`), the payment channel
   IDs (the agent can also call `list_channels`) and a Hermes Agent config snippet.
3. Follow [`docs/agent-guide.md`](docs/agent-guide.md): workflow, tools, reason codes,
   the single-use `confirm_duplicate` rule and refund matching.

The agent's five MCP tools and their REST equivalents (the only operations an agent token
may call; everything else needs the signed-in user):

| MCP tool | REST |
|---|---|
| `list_channels` | `GET /api/v1/channels` |
| `list_categories` | `GET /api/v1/categories` |
| `get_budgets` | `GET /api/v1/budgets` |
| `find_payments` | `GET /api/v1/payments/search` (stored payments only, to match a refund) |
| `submit_transactions` | `POST /api/v1/channels/{channel_id}/transactions/batch` |

Refund matching in the web UI uses `GET /api/v1/transactions` (`refund_status=unmatched`,
`stats`), `GET /api/v1/transactions/{id}/refund-candidates` and `PATCH
/api/v1/transactions/{id}` (`refund_of_id`); the full contract is at `/api/docs`.

### AI insights (optional)

The Dashboard's "全部" view has an **AI 洞察** card: on request, a large language model
summarises the selected month and the year to date in one sentence plus points
(overspending, anomalies, changes, what went well). It is off until configured.

1. Go to 设置 → AI 洞察 and enter an **OpenAI-compatible** service: the Base URL (e.g.
   `https://api.openai.com/v1`, `https://api.deepseek.com/v1`, or
   `http://<host>:11434/v1` for Ollama), the model name and the API key (may be left empty
   for local servers). The backend calls `POST {Base URL}/chat/completions`. Anthropic's
   native API is not supported; use an OpenAI-compatible gateway in front of it.
2. "测试连接" sends one tiny request with the saved settings and shows the latency or the
   reason it failed.
3. On the Dashboard, pick a month and click "生成洞察". The result is stored per month and
   shown again without calling the model; when the month's data changes afterwards the card
   says "数据已更新，可重新生成". A failed generation keeps the previous result.

What is sent, and only when you click 生成: the month's budget, spending and category
rows, the 12-month trend up to that month, the annual budget accounts' year to date, and
**every transaction of that month** (date, amount, category, counterparty, description,
refund information; at most the 1000 largest). Notes, payment channels and IDs are not
sent. Choose the provider accordingly.

The API key is stored in the database in plain text and never returned by the API (only
whether one is set and its last 4 characters); it is therefore also in database backups.
The `api` container needs outbound network access to the provider (or LAN access to an
Ollama host). Generation may take up to 4 minutes (`/api/v1/insights/` gets a 300 s proxy
timeout in nginx).

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

**Upgrading to the payment-channel / budget-account version (migration 0004) clears the
ledger.** Migration `0004_channels_budget_accounts` drops and recreates the business
tables: all accounts, categories, budgets and transactions are deleted. The user, the
login sessions and the agent access tokens are kept. After the upgrade the app opens the
onboarding again (base currency, budget accounts, categories, payment channels); then
update the agent's instructions to the new tools and channel IDs
([`docs/agent-guide.md`](docs/agent-guide.md), "Upgrading from the account-based
version") and have it submit the transactions again. Take a backup first if you want to
keep the old data for reference.

**Migration 0007 (refund matching)** only adds a column: every existing refund is
unmatched and every figure stays as it was. Matching a refund to a payment of an earlier
month changes that month's figures afterwards. Its downgrade drops the matches.

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
| `docs/agent-guide.md` | How an AI agent connects, the five tools and their feedback |
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
