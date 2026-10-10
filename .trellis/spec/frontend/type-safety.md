# Type Safety

> Type safety patterns in this project.

---

## Overview

TypeScript in strict mode with `noUncheckedIndexedAccess`, `noUnusedLocals`,
`noUnusedParameters` and `verbatimModuleSyntax` (`frontend/tsconfig.json`). The API's
types are generated from the backend's contract; the frontend declares no request or
response shape of its own.

---

## Type Organization

- **API types are generated.** `npm run gen:api` (`scripts/gen-api.mjs`) turns
  `backend/openapi.json` into `src/api/schema.gen.ts`. The file is committed and never
  edited. Refer to schemas through the alias in `src/api/client.ts`:

  ```ts
  import type { Schemas } from "@/api/client";
  function AccountSelect({ accounts }: { accounts: readonly Schemas["AccountOut"][] }) { ... }
  ```

- **Paths, parameters and bodies are checked by `openapi-fetch`**: a misspelt path, a
  missing path parameter or an unknown body field is a compile error in `api/queries.ts`.
- **View models** that are not API shapes live next to their producer
  (`TrendPoint`, `ShareSlice` in `pages/dashboard/model.ts`; `Usage` in `lib/budget.ts`;
  `BudgetDraft`, `ParsedAmount` in `pages/budgets/model.ts`). Request parameters that
  are also part of a query key get a named type next to the keys (`TransactionFilter` in
  `api/queries.ts`).
- **Request bodies are built as the generated type**, so a misspelt or non-editable field
  does not compile: `transactionChanges()` returns `Schemas["TransactionUpdateIn"] | null`
  with only the changed fields, `budgetChanges()` returns `Schemas["BudgetItemIn"][]`.
- Type-only imports use `import type` or inline `type` (eslint
  `consistent-type-imports`).

---

## Validation

Types describe the contract; three boundaries are checked at run time:

- **Errors.** `unwrap()` in `src/api/client.ts` is the only place a failed response is
  interpreted. It checks the body against the error envelope with a type guard and always
  throws `ApiError { status, code, message, details }`. Two codes exist only on the
  client: `NETWORK_ERROR` (no response, or a proxy's 502/503/504) and
  `UNEXPECTED_RESPONSE` (a non-2xx body that is not the envelope). Branch on `code` with
  `isApiError(error, "CODE")`; show `errorMessage(error)`.
- **Money strings.** `toCents()` in `src/lib/money.ts` accepts only
  `-?digits(.dd)?` and throws otherwise; `formatMoney()` calls it before formatting.
- **URL parameters.** `isMonth()` in `src/lib/month.ts` guards the `month` search
  parameter; unknown values fall back to a default instead of reaching the API.

Successful response bodies are trusted to match the generated types (the backend's tests
keep `openapi.json` in step with the code); they are not re-validated in the browser.

---

## Common Patterns

- **Money is a string end to end.** The API sends `"35.50"`; arithmetic is integer cents
  (`toCents`, `fromCents`, `subtract`); display is
  `Intl.NumberFormat.format(value as Intl.StringNumericLiteral)`, which formats the decimal
  string exactly. `toChartNumber()` is the single conversion to a float and is for chart
  geometry only.
- **`budget: string | null`.** `null` is "no budget", `"0.00"` is a budget of zero. Code
  must handle `null` explicitly; `usage()` turns the pair into a discriminated `state`.
  On the way in, `parseBudgetInput()` maps an empty input to `null` and a typed amount to
  a two-decimal string (`{ valid: true; amount: string | null } | { valid: false }`), and
  `sameBudget()` compares by value with `null` equal only to `null`. The PUT sends
  `amount: null` to clear a budget from the chosen month.
- **Optional PATCH fields mean "unchanged"; `null` means "remove".** For
  `TransactionUpdateIn` an absent `note` keeps the note and `note: null` deletes it, so
  never send a field the user did not change.
- **Calendar days are strings.** A transaction's `date` (`YYYY-MM-DD`) is formatted by
  `formatDay()` (`lib/date.ts`) from its parts, never through `Date`, so no time zone
  can move it to another day. Only instants (`created_at`, `last_used_at`) go through
  `Date` (`formatDateTime()`).
- **Months are `YYYY-MM` strings**, compared as strings and stepped with `addMonths()`.
  Dates are not parsed into `Date` except to read "now".
- **Discriminated unions for state** (`StageState`, `Usage["state"]`) and `Record<Union, T>`
  for per-case tables (`FILL` in `budget-meter.tsx`, `STAGE_HOME`), so adding a case is a
  compile error where it is not handled.
- **`satisfies`** for configuration that must match a library type but keep its literal
  keys (`config satisfies ChartConfig` in `trend-chart.tsx`).

---

## Forbidden Patterns

- Hand-written request or response types, or editing `schema.gen.ts`.
- `any`, and `as` casts on API data. The existing casts are at library boundaries only:
  Recharts tooltip payloads (`item.payload as TrendPoint`), `Object.keys` of the
  currencies map, and the `StringNumericLiteral` cast in `formatMoney`.
- `Number(amount)`, `parseFloat(amount)` or `+amount` on money, and summing floats.
- Non-null `!` on data. It is used for `document.getElementById("root")!` and where an
  array was just built with a known length (`niceTicks`).
- Branching on an error's `message` text or HTTP status where a `code` exists.
