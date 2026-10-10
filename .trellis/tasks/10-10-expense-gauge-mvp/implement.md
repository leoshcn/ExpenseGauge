# ExpenseGauge MVP - Implementation Plan

Each step ends with its validation passing before the next starts. Steps 1-6 are backend, 7-9 frontend, 10-11 integration.

## Checklist

1. **Scaffold**
   - `backend/` (FastAPI app, config, db session, Alembic, pytest, ruff), `frontend/` (Vite + React + TS, eslint, vitest), `docker-compose.yml`, `.env.example`, root `.gitignore`, README.
   - Health endpoint; compose brings up three services.
   - Fill `.trellis/spec/backend/directory-structure.md` and `.trellis/spec/frontend/directory-structure.md` with the layout actually created.
2. **Auth**: `users`, `sessions`, `api_tokens` models and migration; setup, login, logout, me; token CRUD; auth dependencies with the session/agent scope split; error envelope and exception handlers. (AC2, AC4, AC5)
3. **Accounts and categories**: models, migration, endpoints, two-level rules, delete-only-when-unused. (AC3 backend, AC6, AC15)
4. **Budgets**: model, effective-from resolution, GET by month, PUT. (AC6, AC12)
5. **Transactions**: model, fingerprint, batch submission with per-item feedback and advisory lock, list, patch, delete. (AC7-AC11, AC14 backend)
6. **Summaries**: monthly series and selected-month breakdown. (AC11-AC13 backend)
7. **MCP**: mount Streamable HTTP app at `/mcp`, token middleware, three tools over the service layer; test with the SDK client. (AC16)
8. **Frontend foundation**: generated API client, query setup, route guard, layout, `strings.zh.ts`; setup, login and onboarding pages. (AC2, AC3)
9. **Frontend pages**
   - 9a. Design spec (tokens, type scale, spacing, chart palette) and the Dashboard page. **Stop: user reviews the Dashboard visually and approves before 9b.**
   - 9b. Transactions, budgets, settings (accounts, categories, tokens). (AC5, AC12-AC15)
10. **Deployment**: production Dockerfiles, nginx config for `/`, `/api`, `/mcp`; only `web` published; migrations on start. (AC1)
11. **Docs and specs**: `docs/agent-guide.md` (workflow, Hermes config snippet, tools, reason codes, single-use confirmation flag); fill the remaining `.trellis/spec/` files from the code as written. (AC18)
12. **End-to-end check**: on a clean `docker compose up`, walk AC1-AC16 once by hand or script, including one MCP call through nginx.

## Validation Commands

```bash
# backend
cd backend && uv run ruff check . && uv run pytest
# frontend
cd frontend && pnpm gen:api && pnpm tsc --noEmit && pnpm lint && pnpm test
# stack
docker compose up -d --build && docker compose ps
curl -s http://localhost:8080/api/v1/setup/status
```

Backend tests run against a real PostgreSQL (compose `db` or a test container), not SQLite, because of `NUMERIC` and advisory locks.

## Risky Points

- **Batch duplicate check under concurrency** (step 5): must hold the per-account lock for the whole validate-and-insert transaction. Covered by a concurrent-submission test.
- **MCP mounted inside FastAPI** (step 7): the SDK's session manager needs the app lifespan wired through; path handling behind nginx (`/mcp` vs `/mcp/`) needs a check. Fallback: run the MCP app as a separate process from the same image.
- **Budget resolution query** (steps 4, 6): "latest effective_from <= month" per category across a 12-month series; verify with a test that changes a budget mid-range.
- **Windows host**: line endings for shell scripts and Dockerfile entrypoints; `.gitattributes` must keep them LF.

## Before `task.py start`

- User has approved the final planning summary.
- `implement.jsonl` and `check.jsonl` hold real entries.
- Decide whether to run this as one task or split steps into child tasks (recommended: backend 1-7, frontend 8-9, integration 10-12).
