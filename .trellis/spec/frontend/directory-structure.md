# Directory Structure

> How frontend code is organized in this project.

---

## Overview

Organised by kind at the top level (`api`, `components`, `hooks`, `lib`, `pages`), and by
route inside `pages`. A page that needs more than one file gets a folder; code used by one
page stays in that folder until a second page needs it.

---

## Directory Layout

```
frontend/
  index.html               theme script that runs before first paint
  DESIGN.md                design spec: tokens, type scale, chart rules, rationale
  components.json          shadcn/ui CLI configuration
  vite.config.ts           plugins, `@` alias, `/api` and `/mcp` dev proxy, vitest config
  scripts/
    gen-api.mjs            backend/openapi.json -> src/api/schema.gen.ts
    screenshots.mjs        Playwright captures into docs/screenshots/
  docs/screenshots/        reference screenshots of every page, both widths and themes
  src/
    main.tsx               providers: QueryClient, BrowserRouter
    App.tsx                the route table, every route under a RequireStage
    index.css              design tokens (light, dark) and the Tailwind theme mapping
    strings.zh.ts          every user-facing string
    api/
      schema.gen.ts        GENERATED, committed, never edited
      client.ts            openapi-fetch client, ApiError, unwrap()
      queries.ts           query keys, queryOptions, request functions for mutations
      query-client.ts      QueryClient defaults (retry, 401 handling)
    components/            shared components: app-layout, route-guard, budget-meter,
                           account-select, confirm-dialog, copy-button, currency-select,
                           empty-state, error-state, form-field ...
      ui/                  vendored shadcn/ui components (incl. dialog, alert-dialog,
                           tabs, textarea)
    hooks/                 use-stage, use-theme, use-media-query, use-search-state
                           (URL state + selected account), use-restore-focus
    lib/                   pure functions: money.ts, month.ts, budget.ts, date.ts;
                           clipboard.ts (copy with a non-HTTPS fallback)
    pages/
      setup.tsx, login.tsx, onboarding.tsx
      dashboard/
        index.tsx          the page: URL state, queries, loading/empty/error states
        model.ts           pure derivations (trend points, shares, axis ticks)
        month-summary.tsx, trend-chart.tsx, category-table.tsx, share-chart.tsx
      transactions/
        index.tsx          URL filter, list query, which dialog is open
        model.ts           readFilter, monthOptions, pageRange, transactionChanges
        filters.tsx, transaction-table.tsx, edit-dialog.tsx (edit + delete dialogs)
      budgets/
        index.tsx          effective month, draft state, save bar, PUT mutation
        model.ts           parseBudgetInput, budgetChanges, sumBudgets, groupLines
        budget-table.tsx
      settings/
        index.tsx          tabs (?tab=accounts|categories|agent)
        model.ts           mcpEndpoint, hermesConfig, activeFirst
        accounts-section.tsx, categories-section.tsx, agent-section.tsx,
        name-dialog.tsx (one-field add/rename dialog), section-card.tsx
    test/setup.ts          jest-dom matchers, cleanup, matchMedia stub
```

---

## Module Organization

- **A new page** goes in `src/pages/`, is registered in `src/App.tsx` inside the right
  `RequireStage`, and gets its navigation entry in `NAV` in
  `src/components/app-layout.tsx`.
- **Everything that touches the network** is in `src/api/`. Pages import query options and
  request functions from `api/queries.ts`; they do not call `api.GET` themselves.
- **Calculations** (money, months, budget states, chart data) are pure functions in
  `src/lib/` or a page's `model.ts`, with a test file beside them. Components call them and
  render the result.
- **`src/components/ui/`** is owned by this repo (vendored), but changes there should stay
  small so `npx shadcn add` can still be used. Project-specific components go in
  `src/components/`.
- Imports use the `@/` alias for anything outside the current folder, `./` within it.

---

## Naming Conventions

- Files: `kebab-case.tsx` / `.ts`. Tests: the same name with `.test.ts(x)`, next to the file.
- Components: `PascalCase` named exports (no default exports). Hooks: `useThing` in
  `use-thing.ts`.
- Query options: `<thing>Query` (a value, or a function when it takes parameters).
  Request functions for mutations: verbs (`createAccount`, `login`).
- The strings object is `S`; a file that uses one section may alias it
  (`const T = S.dashboard`).

---

## Examples

- A page folder with a model and tests: `src/pages/dashboard/`, `src/pages/budgets/`
  (`model.test.ts` for the diffing, `budget-table.test.tsx` for what the user sees).
- A shared component that draws one concept everywhere: `src/components/budget-meter.tsx`.
- A pure library with tests: `src/lib/money.ts`, `src/lib/money.test.ts`.
