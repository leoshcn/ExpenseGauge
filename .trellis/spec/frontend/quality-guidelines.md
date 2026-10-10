# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Four commands must pass before a change is handed over, run from `frontend/` (use
`npm.cmd` on Windows shells that cannot find `npm`):

```bash
npm run gen:api      # only when backend/openapi.json changed; commit the result
npm run typecheck    # tsc, strict
npm run lint         # eslint: typescript-eslint, react-hooks, react-refresh
npm run test         # vitest
```

`npm run build` additionally proves the production bundle builds. Anything visible is also
checked in a browser against the real API with seeded data (see `frontend/README.md`), at
desktop and phone widths and in both themes; `npm run screenshots` regenerates
`docs/screenshots/` for review (`npm run screenshots -- budgets` for one page). The
script must not change data: open dialogs and cancel them, and stub responses that would
create something (`page.route`, as for the one-time token).

---

## Forbidden Patterns

| Pattern | Why | Instead |
|---|---|---|
| Copy in JSX or in `lib/` | R9: one file holds all copy | `src/strings.zh.ts` |
| Hand-written API types, editing `schema.gen.ts` | The contract is `backend/openapi.json` | `npm run gen:api` |
| `fetch` or `api.GET` outside `src/api/` | Errors bypass `ApiError`; keys drift | `queries.ts` + `unwrap()` |
| Floats for money | Rounding errors in totals and remaining | `src/lib/money.ts` |
| Raw colours or Tailwind palette colours | Breaks dark mode and the design spec | tokens in `src/index.css` |
| Re-deriving budget thresholds or colours | States would disagree between views | `usage()` and `BudgetMeter` |
| External font or asset URLs | The app runs on a LAN without internet | bundle it (as Inter is) |
| Backend changes from a frontend task | The backend is a separate, checked task | report the gap |
| An i18n framework | Out of scope (R9) | `strings.zh.ts` |

---

## Required Patterns

- Every data view handles loading, empty, error and loaded.
- Error text shown to the user is the backend's `message`; the `code` is shown beside it
  on full-page failures (`ErrorState`).
- New visual decisions (a token, a state, a chart rule) are added to `frontend/DESIGN.md`
  in the same change.
- New routes are wrapped by `RequireStage` in `App.tsx`.
- Pure logic goes in `lib/` or a `model.ts` with tests; components stay thin.

---

## Testing Requirements

- **Pure functions are tested thoroughly**, including the awkward values: zero budgets,
  `null` budgets, negative actuals from refunds, large amounts, year boundaries
  (`lib/*.test.ts`, `pages/*/model.test.ts`). Anything that decides what is sent to the
  API is tested as a function: `transactionChanges` (only changed fields, `null` to
  remove a note), `budgetChanges` (clear vs zero, unchanged rows left out, invalid rows
  reported, the same draft re-diffed against another month).
- **The API client's error handling is tested** with a stub `fetch`
  (`api/client.test.ts`): envelope, non-envelope, proxy error, no connection, 204.
- **Components are tested through what the user sees** with Testing Library: roles, labels
  and text from the UI, not class names (`pages/dashboard/category-table.test.tsx`,
  `pages/budgets/budget-table.test.tsx`, which drives the inputs and checks the request
  items that would be sent).
- **Page wiring** (what a page asks for and when it lets the user save) is tested by
  rendering the page in a `QueryClientProvider` and `MemoryRouter` with `@/api/queries`
  partly mocked (`vi.mock`, keeping `keys`): `pages/budgets/index.test.tsx` (no save
  while another month loads), `pages/transactions/index.test.tsx` (an unknown URL
  category never reaches the API), `pages/settings/agent-section.test.tsx` (the one-time
  token is gone from the query client once its dialog closes).
- Tests are deterministic: no real clock (pass `now`), no network.
- Not covered by automated tests today, and therefore checked by hand in the browser:
  the route guard and the setup/login/onboarding flow, chart rendering and month selection
  by click (jsdom has no layout), and the mutation flows against the real API (edit and
  delete a transaction and see the Dashboard change, set a budget from one month and clear
  it from a later one, create and revoke a token, delete a category in use and an unused
  one), and keyboard use of the dialogs. Extend the Playwright script or add tests when
  these change.

---

## Code Review Checklist

- [ ] `typecheck`, `lint`, `test` pass; `schema.gen.ts` is current.
- [ ] No copy outside `strings.zh.ts`; no colour outside the tokens.
- [ ] Money never becomes a float except through `toChartNumber` for chart geometry.
- [ ] `budget: null` is presented as "未设预算", not as zero.
- [ ] Loading, empty and error states exist and were looked at.
- [ ] Looked at in the browser at about 390 px and at desktop width, light and dark.
- [ ] Icon-only buttons have labels; state is not shown by colour alone.
- [ ] Query keys come from `keys`; mutations update or invalidate the caches they affect
  (table in hook-guidelines.md), including the Dashboard's.
- [ ] Dialogs restore focus, stay open while saving, and show the backend's refusal.
- [ ] `DESIGN.md` and these spec files still describe the code.
