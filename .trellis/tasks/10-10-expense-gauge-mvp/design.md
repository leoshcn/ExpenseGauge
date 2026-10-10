# ExpenseGauge MVP - Technical Design

## Architecture

```
browser ──┐
          ├─> web (nginx) ── /        static frontend build
agent  ───┘                  /api/*   -> api:8000
                             /mcp     -> api:8000
                    api (FastAPI + mounted MCP app) ── db (PostgreSQL)
```

- One `api` process serves REST and the MCP Streamable HTTP app, mounted at `/mcp`. MCP tools call the same service functions as the REST routers. This replaces the earlier idea of a second entrypoint: one process means one auth path and one copy of the rules.
- Layers in the backend: `routers` (HTTP shape) -> `services` (rules, transactions) -> `models` (SQLAlchemy). `mcp` sits beside `routers` and depends only on `services`.

## Repository Layout

```
backend/
  app/{main.py, config.py, db.py, deps.py}
  app/models/        SQLAlchemy 2.x models
  app/schemas/       Pydantic request/response models
  app/services/      business rules
  app/routers/       REST endpoints
  app/mcp/           MCP tool definitions
  alembic/           migrations
  tests/
  pyproject.toml, Dockerfile
frontend/
  src/{api/, pages/, components/, strings.zh.ts}
  package.json, vite.config.ts, Dockerfile, nginx.conf
docs/agent-guide.md
docker-compose.yml
.env.example
```

Tooling: `uv` + `ruff` + `pytest` for the backend; `pnpm` + `vitest` + `tsc` + `eslint` for the frontend; `openapi-typescript` for the client types; TanStack Query and React Router in the frontend.

## Data Model

| Table | Columns | Constraints |
|---|---|---|
| `users` | id, username, password_hash, created_at | at most one row (enforced in service) |
| `sessions` | id (random token hash), user_id, expires_at | |
| `api_tokens` | id, name, token_hash, created_at, last_used_at, revoked_at | |
| `accounts` | id, name, currency (ISO 4217) | unique(name) |
| `categories` | id, account_id, parent_id (null = level 1), name | unique(account_id, parent_id, name); a parent must itself have parent_id null |
| `budgets` | id, category_id, effective_from (first day of month), amount NUMERIC(14,2) | unique(category_id, effective_from); category must be level 2; amount >= 0 |
| `transactions` | id, account_id, category_id, date, amount NUMERIC(14,2), counterparty, description, note, fingerprint, confirmed_duplicate, api_token_id, created_at | index(account_id, fingerprint) non-unique; index(account_id, date); amount != 0; category must be level 2 of the same account |

- The budget in force for category C in month M is the row with the greatest `effective_from <= M`. Amount 0 is a real budget. "No budget" means either no row at all, or the row in force has a NULL amount (a cleared budget).
- `fingerprint` = sha256 of `account_id | date | amount (2 dp) | norm(counterparty) | norm(description)`, where `norm` = Unicode NFKC, trim, collapse whitespace, casefold.
- The fingerprint index is not unique because confirmed duplicates are legitimate rows.

## API Contract (`/api/v1`)

Auth column: S = session cookie, A = agent token also accepted.

| Method and path | Auth | Purpose |
|---|---|---|
| GET `/setup/status` | none | whether a user exists |
| POST `/setup` | none | create the only user; 409 once one exists |
| POST `/auth/login`, POST `/auth/logout`, GET `/auth/me` | none / S | session |
| GET, POST `/tokens`; DELETE `/tokens/{id}` | S | agent tokens |
| GET, POST `/accounts`; PATCH `/accounts/{id}` | S | accounts |
| GET `/accounts/{id}/categories` | S, A | two-level tree |
| POST `/accounts/{id}/categories`; PATCH, DELETE `/categories/{id}` | S | category edits |
| GET `/accounts/{id}/budgets?month=YYYY-MM` | S, A | budget in force per level-2 category |
| PUT `/accounts/{id}/budgets` | S | set amounts effective from a month; an amount of `null` clears the budget from that month |
| POST `/accounts/{id}/transactions/batch` | S, A | all-or-nothing submission |
| GET `/accounts/{id}/transactions` | S | list, filter by month and category, paginated |
| PATCH, DELETE `/transactions/{id}` | S | edit category/note, delete |
| GET `/accounts/{id}/summary/monthly?from=&to=` | S | per month: total budget, total actual |
| GET `/accounts/{id}/summary/months/{YYYY-MM}` | S | level-1 rows with nested level-2 rows: budget, actual |

Agent tokens identify accounts by ID; `list_accounts` is not exposed, so the account ID goes into the agent's configuration.

### Error envelope

Every non-2xx response has the same shape, so agents handle one format:

```json
{ "code": "CATEGORY_IN_USE", "message": "该分类下已有流水，无法删除", "details": {} }
```

### Batch submission

Request: `{ "items": [ { "date", "amount", "counterparty", "description", "category_id", "note?", "confirm_duplicate?": false } ] }`, at most 500 items.

- All items valid: `201` with the created records.
- Any item rejected: `409`, nothing written:

```json
{
  "code": "BATCH_REJECTED",
  "message": "本批共 3 条，其中 1 条被拒绝，未写入任何数据",
  "details": { "items": [
    { "index": 0, "status": "ok" },
    { "index": 1, "status": "rejected", "code": "SUSPECTED_DUPLICATE",
      "message": "…", "existing": { }, "hint": "与用户确认后，带 confirm_duplicate=true 重新提交该条" }
  ] }
}
```

Item reason codes: `SUSPECTED_DUPLICATE` (returns `existing`), `DUPLICATE_IN_BATCH` (returns the other `index`), `CATEGORY_NOT_FOUND` (returns `valid_categories`), `CATEGORY_NOT_LEAF` (returns that parent's children), `INVALID_FIELD` (returns field and reason).

- `confirm_duplicate=true` on an item with a matching fingerprint inserts it and sets `confirmed_duplicate`. On an item with no match the flag is ignored.
- Validation and insert run in one database transaction with an advisory lock per account, so two concurrent batches cannot both pass the duplicate check.

## MCP

- Built with the official MCP Python SDK, Streamable HTTP, stateless mode, mounted at `/mcp`.
- Auth: the same Bearer token check as REST, applied as ASGI middleware on the mounted app.
- Tools: `list_categories(account_id)`, `get_budgets(account_id, month?)`, `submit_transactions(account_id, items)`. Results are the REST payloads. A rejected batch is returned as a normal tool result with `accepted: false`, not as a protocol error, so the agent reads the per-item feedback.

## Auth and Security

- Passwords hashed with argon2. Session ID is a random 256-bit value; only its hash is stored. Cookie: HttpOnly, SameSite=Lax, 30-day sliding expiry.
- CSRF: state-changing endpoints accept only `application/json`, combined with SameSite=Lax.
- Tokens: `eg_` + 32 random bytes; SHA-256 stored. Scope is enforced by a dependency that allows token auth only on the endpoints marked A.
- Basic guard on login: fixed delay after failed attempts. Anything stronger is out of scope (LAN-only deployment).
- Secrets and database credentials come from `.env`; `.env.example` is committed, `.env` is git-ignored.

## Frontend

- Routes: `/setup`, `/login`, `/onboarding`, `/dashboard`, `/transactions`, `/budgets`, `/settings`.
- A route guard reads `/setup/status` and `/auth/me` and redirects to setup, login or onboarding (no account, or no usable category yet).
- Dashboard: account selector, 12-month bar series of budget vs. actual, selected-month table with expandable level-1 rows, donut chart of level-1 actuals.
- UI kit: shadcn/ui components vendored into `src/components/ui`, styled with Tailwind CSS; design tokens as CSS variables (light and dark). Charts use Recharts via the shadcn/ui chart wrappers so chart colours, tooltips and typography come from the same tokens.
- All copy in `src/strings.zh.ts`. Money formatted with `Intl.NumberFormat` using the account currency.

## Trade-offs

- All-or-nothing batches keep monthly totals from being half-loaded, at the cost of resubmitting whole batches.
- Duplicate handling by reject-and-confirm (user's choice) keeps the agent simple but is not idempotent when flags are reused; mitigated only by documentation in the agent guide.
- Agents address accounts by ID from configuration. Simple, but adding an account means updating agent config.
- PostgreSQL over SQLite adds a container but gives `NUMERIC`, advisory locks and no later migration.

## Operations

- Migrations run automatically on `api` start (`alembic upgrade head`).
- Data lives in a named Docker volume for `db`. Backup is `pg_dump` via `docker compose exec`, documented in the README.
- Rollback: the MVP is additive on an empty repo; reverting is removing containers and the volume.
