# ExpenseGauge MVP

## Goal

A single-user personal expense management web app. Per account, the user sees actual spending against budget by category on a dashboard and adjusts their decisions.

AI agent participation is an initial design condition. The user's agent (Hermes Agent) pulls bank transactions, classifies them against the account's categories, discusses uncertain ones with the user, then submits confirmed records through the API or MCP. The system is the source of truth for categories, budgets and stored transactions, and it must give the agent feedback it can act on.

Source requirements: `userinput/requirement.md`.

## Background and Constraints

- Greenfield repo: only Trellis scaffolding exists and `.trellis/spec/{backend,frontend}` are unfilled templates.
- Front/back separated architecture, deployed with Docker Compose.
- Single user, with login authentication.
- The bank provides no transaction ID.

## Requirements

### R1 Stack and deployment

- Backend: Python + FastAPI, auto-generated OpenAPI, structured validation errors.
- Database: PostgreSQL; money stored as `NUMERIC`.
- Frontend: React + TypeScript + Vite, typed client generated from OpenAPI. UI components: shadcn/ui + Tailwind CSS; charts: Recharts through the shadcn/ui chart wrappers, sharing the UI's design tokens.
- Visual quality is a stated user priority: a design spec (colour, type scale, spacing, chart palette) is set first and the Dashboard is shown to the user for visual approval before the remaining pages are built.
- Compose services: `web` (nginx: static files + reverse proxy for `/api` and `/mcp`), `api`, `db`. Only the `web` port is published.
- Runs on the user's own machine or home server, localhost/LAN only. No built-in HTTPS or certificate management; a fronting reverse proxy can be added later without app changes.

### R2 Agent interface

- The REST API is the single core. The web frontend and agents call the same API.
- A thin MCP server wraps it, served over Streamable HTTP at `/mcp`, exposing exactly three tools: `list_categories(account)`, `get_budgets(account)`, `submit_transactions(...)`.
- Validation and feedback rules live in the API/service layer, never in the MCP layer.
- Hermes Agent connects via `mcp_servers.<name>.url` + `headers` in `~/.hermes/config.yaml` (see `research/hermes-agent-mcp.md`).

### R3 Authentication

- User (web): username + password, argon2 hash, HttpOnly session cookie. The "create user" page is open only while no user exists.
- Agent (REST and MCP): API tokens generated on the settings page, sent as `Authorization: Bearer`. Shown once at creation, stored hashed, revocable.
- Agent token scope: read an account's categories, read an account's budgets, submit transactions. Nothing else: no budget or category edits, no deletions, no reading stored transactions or actuals, no user info.

### R4 Money scope

- Each account has one currency, set at creation. No FX conversion; the dashboard shows one account at a time.
- Only expenses and refunds are stored. Expense = positive amount. Refund = negative amount in the original expense's category, reducing that category's monthly actual.
- Income, interest, inter-account transfers and card repayments are filtered out by the agent before submission. There is no income type.
- Transaction fields: date, amount, counterparty, description, category, optional note.
- A transaction belongs to the month of its date.

### R5 Categories

- Two levels per account.
- Transactions and budgets attach only to level-2 categories. Level-1 categories only group and aggregate.
- A level-1 category needs at least one level-2 child to be usable.

### R6 Budgets

- One monthly amount per level-2 category, effective from a chosen month and carried forward until the next change.
- Earlier months keep the budget version in force at the time.
- A level-1 budget is the computed sum of its level-2 budgets; it cannot be entered directly.
- No rollover of surplus or overspend.
- A budget can be cleared from a chosen month onward, returning the category to "no budget" for that month and later; earlier months keep their budget.

### R7 Transaction submission (agent)

- Identity is a server-computed content fingerprint: account + date + amount + normalized counterparty and description.
- A fingerprint matching an existing record, or another item in the same batch, is rejected as a suspected duplicate with the matching record returned. The agent confirms with the user and resubmits that item with an explicit confirmation flag, which inserts it as a separate transaction.
- There is no silent "already present, skip". Re-running a batch without flags writes nothing. Re-running a batch that still carries confirmation flags double-books those items; the agent guide must say flags are single-use.
- A category that does not belong to the account is rejected with the account's valid categories. A level-1 category is rejected with that parent's level-2 list.
- Batches are all-or-nothing. If any item is rejected nothing is written, and the response carries per-item status, reason code, message and related existing record.
- Agents can never change an existing record.

### R8 Web UI

- Onboarding: create user, then guided first account, then guided categories under that account.
- Dashboard: account selector; month-by-month summary; for the selected month, budget vs. actual by level-1 category with drill-down to level-2; category share chart by level-1. Categories with no budget show "no budget" with actuals only.
- Transactions page: list and filter transactions; edit category and note; delete a single transaction. No manual creation; amount, date and counterparty are not editable.
- Budget page: enter budgets per account and level-2 category, choosing the effective month.
- Settings: add and rename accounts (no deletion); add and rename categories, delete only when no transaction uses them (a level-2 category that has only budgets can be deleted and its budgets go with it); create and revoke agent tokens.

### R9 Language

- UI in Simplified Chinese only. Copy lives in one file; no i18n framework.
- API and MCP field names, tool names and reason codes in English. Every feedback item also carries a Chinese message the agent can relay.
- User data (category, account, counterparty names) is stored as entered.

### R10 Agent-first project conventions

- An agent integration guide documents the workflow, tools, reason codes and the single-use confirmation flag rule.
- `.trellis/spec/` is filled with the conventions this MVP establishes so later coding agents work from them.

## Acceptance Criteria

- [ ] AC1 `docker compose up` on a clean checkout brings up `web`, `api`, `db`; only the `web` port is published; the app is reachable in a browser.
- [ ] AC2 With no user, the app routes to user creation. After creating one, the creation endpoint refuses further users.
- [ ] AC3 After user creation, the user is guided to create a first account (name + currency) and at least one level-1 category with one level-2 child before reaching the dashboard.
- [ ] AC4 All non-setup API endpoints reject unauthenticated requests, except the health check and the API documentation (`/api/docs`, `/api/openapi.json`), which are public by user decision and expose no data. A session cookie grants full access. An agent token grants only the three agent operations and gets 403 elsewhere.
- [ ] AC5 A token is displayed once at creation, is not retrievable afterwards, and stops working immediately after revocation.
- [ ] AC6 `list_categories` returns the account's full two-level tree. `get_budgets` returns the budget per level-2 category for a requested month.
- [ ] AC7 A valid batch is stored in full and appears on the transactions page and in dashboard actuals.
- [ ] AC8 A batch containing one item with an unknown category, or a level-1 category, stores nothing; the response identifies the item by index with a reason code, a Chinese message and the valid categories.
- [ ] AC9 Resubmitting an already stored transaction stores nothing and returns `SUSPECTED_DUPLICATE` with the existing record. The same item resubmitted with the confirmation flag is stored as a second transaction.
- [ ] AC10 Two identical items in one batch without flags are rejected as in-batch duplicates.
- [ ] AC11 A refund (negative amount) reduces its category's actual for that month.
- [ ] AC12 Setting a budget effective from month M changes budget figures for M and later months and leaves earlier months unchanged. Clearing a budget from month M shows "no budget" for M and later and leaves earlier months unchanged.
- [ ] AC13 Dashboard: switching account changes all figures; the monthly summary shows total budget and total actual per month; the selected month shows level-1 rows that expand to level-2 rows; the share chart reflects level-1 actuals; unbudgeted categories show "no budget". Month totals: actual includes every category, budget only budgeted ones (user decision, kept as is), so unbudgeted spending alone can make a month read as over budget.
- [ ] AC14 On the transactions page the user can change a transaction's category (to a level-2 category of the same account) and note, and delete a transaction; dashboard figures reflect the change.
- [ ] AC15 A category with transactions cannot be deleted; one without transactions can, including one that has budgets.
- [ ] AC16 The three MCP tools work from an MCP client over HTTP at `/mcp` with a Bearer token and return the same results and rejections as the REST endpoints.
- [ ] AC17 Backend tests, frontend type check and frontend tests pass; the OpenAPI document is served and the frontend client is generated from it.
- [ ] AC18 The agent integration guide exists and `.trellis/spec/` backend and frontend files describe the conventions actually used.

## Out of Scope

- Category adjustment workflow: merge, split, bulk re-assignment of transactions.
- Multi-user, sharing, roles.
- Income, transfers, balances, net cash flow.
- Multi-currency conversion or cross-account totals.
- Budget rollover.
- Manual transaction entry; editing amount, date or counterparty.
- Agent read access to stored transactions or actual spending.
- Public internet deployment: built-in HTTPS, certificates, login rate limiting beyond a basic guard.
- UI languages other than Simplified Chinese.
- Bank connectivity. Fetching statements is the agent's job, outside this system.
