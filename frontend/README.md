# ExpenseGauge frontend

React + TypeScript + Vite. React Router, TanStack Query, Tailwind CSS v4, shadcn/ui
components vendored into `src/components/ui`, Recharts through the shadcn/ui chart
wrapper. The UI is Simplified Chinese; all copy is in `src/strings.zh.ts`.

Pages: setup, login, onboarding, Dashboard (概览), transactions (流水), budgets (预算) and
settings (设置: base currency, budget accounts and payment channels; the global category
tree; AI agent tokens and connection details). The design
spec is [`DESIGN.md`](./DESIGN.md).

This project uses **npm** (not pnpm; the parent plan's `pnpm ...` commands map one to one).
On Windows shells where `npm` is not found, call `npm.cmd` and `npx.cmd` instead.

## See it running (no Docker)

Three terminals, from the repository root. Requires [uv](https://docs.astral.sh/uv/) and
Node 22.12 or newer.

```bash
# 1. Backend on an embedded PostgreSQL (data in backend/.pgdata/dev, git-ignored)
cd backend
uv sync
uv run python -m scripts.dev_server --reset     # http://127.0.0.1:8000 ; --reset empties the dev database

# 2. Demo data, through the public API (needs an empty database, hence --reset above)
cd backend
uv run python -m scripts.seed_demo              # prints: sign in as demo / expense-gauge-demo

# 3. Frontend dev server
cd frontend
npm install
npm run dev                                     # http://localhost:5173
```

Open <http://localhost:5173> and sign in as `demo` / `expense-gauge-demo`.

- Leave out `--reset` on later starts to keep the data. Stop the backend with Ctrl+C, which
  is meant to stop the embedded PostgreSQL too. If `postgres.exe` processes remain, the
  next start reuses them; to stop them by hand:
  `backend/.venv/Lib/site-packages/pgserver/pginstall/bin/pg_ctl stop -D backend/.pgdata/dev`.
- To walk through first-run setup and onboarding instead, start with `--reset` and skip
  step 2.
- The demo ledger (base currency CNY) has three budget accounts, `日常` and `固定` (nine
  months, over-budget and unbudgeted categories, refunds; three months back a refund
  makes one category negative) and `旅行基金` (budgets but no transactions: the
  Dashboard's empty state with `?scope=<id>`), and four payment channels (`储蓄卡`,
  `招行信用卡`, `支付宝`, `美元信用卡`; the last one's spending is stored converted to CNY
  with the USD amount in the note). Fixed bills are paid from several channels and still
  count towards `固定`.
- The dev server proxies `/api` and `/mcp` to `http://127.0.0.1:8000`, so the browser sees
  one origin and the HttpOnly session cookie works, and the MCP address shown under
  设置 → AI 助手 (`http://localhost:5173/mcp`) works in development too. Another backend address:
  `VITE_API_TARGET=http://host:port npm run dev`.

## Checks

```bash
cd frontend
npm run gen:api      # regenerate src/api/schema.gen.ts from ../backend/openapi.json
npm run typecheck    # tsc
npm run lint         # eslint
npm run test         # vitest (unit and component tests, jsdom)
npm run build        # type check + production bundle in dist/
```

`src/api/schema.gen.ts` is generated and committed. Never edit it; after the backend's
`openapi.json` changes, run `npm run gen:api` and commit the result.

## Screenshots

`docs/screenshots/` holds every signed-in page at desktop (1440 px) and phone (390 px)
widths in light and dark, plus their states and dialogs: `dashboard-*`, `transactions-*`
(filtered, edit, delete, empty, no match), `budgets-*` (unsaved edits, an earlier month,
error) and `settings-*` (each tab, category in use, add dialogs, the one-time token).
To regenerate them, with the three steps above running on a freshly seeded database:

```bash
cd frontend
npm run screenshots                      # all pages
npm run screenshots -- budgets settings  # only some
```

The script changes no data, so it can be run repeatedly against the same database.

The script uses Playwright's Chromium if installed (`npx playwright install chromium`)
and otherwise the Microsoft Edge that ships with Windows.

## Layout

```
src/
  api/            schema.gen.ts (generated), client.ts (fetch client + ApiError),
                  queries.ts (query keys, query options, requests), query-client.ts
  components/     shared components; ui/ holds the vendored shadcn/ui components
  hooks/          use-stage (route guard state), use-theme, use-media-query
  lib/            money.ts, month.ts, budget.ts: pure functions with tests
  pages/          one file or folder per route; dashboard/ has its own model.ts
  strings.zh.ts   every user-facing string
  index.css       design tokens (light and dark) and the Tailwind theme mapping
scripts/          gen-api.mjs, screenshots.mjs
```

