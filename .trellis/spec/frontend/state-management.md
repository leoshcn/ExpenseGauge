# State Management

> How state is managed in this project.

---

## Overview

There is no global store. State lives in one of four places, chosen by who owns the truth:
the server (TanStack Query), the URL, the component, or `localStorage` for one preference.

---

## State Categories

| Kind | Where | Examples |
|---|---|---|
| Server state | TanStack Query cache | user, accounts, category tree, summaries |
| View state worth sharing or reloading | URL search params | Dashboard `?account=<id>&month=YYYY-MM`; transactions `?account&month&category&page`; budgets `?account&month` (the effective-from month); settings `?tab&account` |
| Transient UI state | `useState` in the component | form fields, which table rows are open |
| Device preference | `localStorage` + class on `<html>` | theme (`eg-theme`), via `useTheme()` |

URL state is validated when read and falls back silently: an unknown account id means the
first account, a month outside the 12-month window means the current month
(`DashboardPage` in `pages/dashboard/index.tsx`). It is written with
`setSearchParams(..., { replace: true })` so stepping through months does not fill the
history. The newer pages read and write it through `useSearchState()` /
`useSelectedAccount()` (`hooks/use-search-state.ts`); default values are left out of
the URL (`update({ page: null })`). The transactions filter is parsed by `readFilter()`
(`pages/transactions/model.ts`): a malformed month, a page below 1 or a category not in
the account's tree means "not filtered". While the URL names a category, the list query
waits for the tree (`enabled`), so an unknown category never reaches the API. Changing the account resets the category filter
and the page; changing a filter resets the page.

Form state is plain `useState` with a `validate` function that returns messages from
`strings.zh.ts`; the server's message is shown for anything the client did not catch
(`pages/setup.tsx`). There is no form library.

**The budget draft** (`pages/budgets/index.tsx`) is a `Record<categoryId, text>` of what
the user typed; untouched rows are absent and show the amount in force. What to send is
derived during render by `budgetChanges(lines, draft)`, never stored. The draft survives
a change of month on purpose: it is re-compared with the new month's amounts and saved
from whichever month is shown when the user presses save (the save bar names it). Save is
disabled while that month's amounts are still loading (`isPlaceholderData`), because the
diff would still be against the previous month. On success only the entries saved as typed
are dropped (`draftAfterSave`), so typing during the request is kept; it is also dropped
on "撤销修改" and when the account changes (the body is keyed by account).

---

## When to Use Global State

Not yet, and probably not: nothing in the app is shared between distant components that is
not already server state or URL state. If something of that kind appears, prefer lifting
it to the nearest common page, then a React context scoped to that page. Do not add a
store library without recording the reason here.

---

## Server State

- All of it goes through TanStack Query; see [Hook Guidelines](./hook-guidelines.md) for
  the query and mutation patterns.
- **The route guard is derived server state.** `useStage()` (`hooks/use-stage.ts`) reads
  `/setup/status`, `/auth/me`, `/accounts` and each account's categories, in that order,
  and yields one stage. The decision is the pure `resolveStage()` (tested in
  `hooks/use-stage.test.ts`): a step is consulted only once the steps before it have an
  answer, so a stale failure of a later query never hides an earlier stage (an ended
  session goes to login even if `/accounts` failed with the same 401):

  | Stage | Condition | Home route |
  |---|---|---|
  | `setup` | no user exists | `/setup` |
  | `login` | a user exists, no session | `/login` |
  | `onboarding` | no account, or no account with a level-1 category that has a child | `/onboarding` |
  | `app` | otherwise | `/dashboard` |

  `RequireStage` (`components/route-guard.tsx`) wraps every route in `App.tsx` and
  redirects to the current stage's home when the route is not allowed. Pages therefore
  never navigate after signing in or completing setup: they update the cache
  (`setQueryData(keys.me, user)`) and the guard moves the user.
- `/onboarding` is allowed in both `onboarding` and `app`, so the user is not thrown out
  the moment the first category exists and can add more before continuing.
- `setupStatusQuery` and `meQuery` have `staleTime: Infinity`; they change only through
  the app's own mutations or a 401 (handled in `api/query-client.ts`).
- Derived values (remaining, percentages, chart rows) are computed during render from
  query data by pure functions; they are not stored.

---

## Common Mistakes

- **Copying query data into `useState`.** It goes stale. Derive during render.
- **Navigating imperatively after login or setup.** The guard does it; doing both races.
- **Putting the selected account or month in component state.** A reload would lose it and
  the account selector and the page would need a shared parent state.
- **Blocking the app on a failed background refetch.** The guard uses `isLoadingError`.
