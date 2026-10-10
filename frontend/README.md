# ExpenseGauge frontend

React + TypeScript + Vite. React Router, TanStack Query, Tailwind CSS v4, shadcn/ui
components vendored into `src/components/ui`, Recharts through the shadcn/ui chart
wrapper. The UI is Simplified Chinese; all copy is in `src/strings.zh.ts`.

Status: setup, login, onboarding and the Dashboard are built. Transactions, budgets and
settings are labelled placeholders until the Dashboard's visual design is approved
(parent `implement.md` step 9b). The design spec is [`DESIGN.md`](./DESIGN.md).

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
- The demo has three accounts: `日常账户` (nine months, over-budget and unbudgeted
  categories, refunds; three months back a refund makes one category negative),
  `美元信用卡` (USD) and `旅行基金` (no transactions: the empty state).
- The dev server proxies `/api` to `http://127.0.0.1:8000`, so the browser sees one origin
  and the HttpOnly session cookie works. Another backend address:
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

`docs/screenshots/` holds the Dashboard at desktop (1440 px) and phone (390 px) widths in
light and dark, plus its states. To regenerate them, with the three steps above running:

```bash
cd frontend
npm run screenshots
```

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

Conventions for working in this code are in `.trellis/spec/frontend/`.
