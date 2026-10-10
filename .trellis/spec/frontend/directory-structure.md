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
  vite.config.ts           plugins, `@` alias, `/api` dev proxy, vitest config
  scripts/
    gen-api.mjs            backend/openapi.json -> src/api/schema.gen.ts
    screenshots.mjs        Playwright captures into docs/screenshots/
  docs/screenshots/        reference screenshots of the Dashboard
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
    components/            shared components (app-layout, route-guard, budget-meter ...)
      ui/                  vendored shadcn/ui components
    hooks/                 use-stage, use-theme, use-media-query
    lib/                   pure functions: money.ts, month.ts, budget.ts
    pages/
      setup.tsx, login.tsx, onboarding.tsx, placeholder.tsx
      dashboard/
        index.tsx          the page: URL state, queries, loading/empty/error states
        model.ts           pure derivations (trend points, shares, axis ticks)
        month-summary.tsx, trend-chart.tsx, category-table.tsx, share-chart.tsx
    test/setup.ts          jest-dom matchers, cleanup, matchMedia stub
```

---

## Module Organization

- **A new page** goes in `src/pages/`, is registered in `src/App.tsx` inside the right
  `RequireStage`, and gets its navigation entry in `NAV` in
  `src/components/app-layout.tsx` (set `built: true` when replacing a placeholder).
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

- A page folder with a model and tests: `src/pages/dashboard/`.
- A shared component that draws one concept everywhere: `src/components/budget-meter.tsx`.
- A pure library with tests: `src/lib/money.ts`, `src/lib/money.test.ts`.
