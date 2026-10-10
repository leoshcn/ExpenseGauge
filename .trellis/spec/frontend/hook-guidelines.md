# Hook Guidelines

> How hooks are used in this project.

---

## Overview

There are few custom hooks, on purpose. Data fetching uses TanStack Query's own
`useQuery` / `useMutation` with options defined in `src/api/queries.ts`; a custom hook is
written only when several queries or a browser API must be combined into one answer.

Existing hooks (`src/hooks/`):

| Hook | Returns | Used by |
|---|---|---|
| `useStage()` | `loading`, `error` (+ `retry`), or the installation's stage: `setup`, `login`, `onboarding`, `app` | `components/route-guard.tsx` |
| `useTheme()` | `{ theme, toggle }`; class on `<html>`, persisted in `localStorage` | `components/theme-toggle.tsx` |
| `useMediaQuery(query)` | boolean | `pages/dashboard/trend-chart.tsx` (bar sizes) |

---

## Custom Hook Patterns

- Browser state that lives outside React (theme class, media queries) is read with
  `useSyncExternalStore`, not `useEffect` + `useState`: see `use-theme.ts`.
- A hook that combines queries returns a small discriminated union rather than several
  booleans, so callers cannot forget a case: see `StageState` in `use-stage.ts`.
- Hooks do not format or contain copy; they return data.

---

## Data Fetching

**Reads.** One `queryOptions` per endpoint in `src/api/queries.ts`, with its key from the
`keys` object in the same file. Components spread or pass them:

```ts
const summary = useQuery(monthlySummaryQuery(account.id, firstMonth, lastMonth));
const me = useQuery({ ...meQuery, enabled: userExists });
```

**Writes.** A request function in `queries.ts` (`createAccount`, `login`), wrapped in
`useMutation` in the component that owns the form. On success the mutation updates the
cache it affects, with keys from `keys`:

```ts
const create = useMutation({
  mutationFn: createAccount,
  onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.accounts }),
});
```

When the response is the new state, write it instead of refetching
(`queryClient.setQueryData(keys.me, user)` after login and setup).

**States.** Every view that loads data handles three cases besides success:
`isLoadingError` (render `ErrorState` with `refetch`), no data yet (a skeleton in the final
layout) and empty data (an explanation). Use `isLoadingError`, not `isError`: a failed
background refetch must not replace data that is already on screen.

**Keeping the previous view.** `placeholderData` may keep the last result while the next
loads, but never across accounts, which have different currencies
(`pages/dashboard/index.tsx`).

**Defaults** (`src/api/query-client.ts`): `staleTime` 30 s; only `NETWORK_ERROR` is
retried, once; any 401, from a query or a mutation (`QueryCache` and `MutationCache`
`onError`), sets `me` to `null`, which makes the route guard show the login page.

---

## Naming Conventions

- `use-thing.ts` exports `useThing`.
- Query options: `thingQuery` / `thingQuery(params)`. Keys: `keys.thing`.
- Mutation variables are named for the action (`create`, `signIn`, `add`).

---

## Common Mistakes

- **`queryClient.clear()` to sign out.** Mounted observers keep their last result, so the
  guard never redirects. Set `me` to `null` and remove the other queries (`useLogout` in
  `components/app-layout.tsx`).
- **Inventing a query key in a component.** Invalidation then misses it. Add it to `keys`.
- **Calling `api.GET` in a component** or without `unwrap()`: errors would not become
  `ApiError`.
- **Reading `new Date()` during render** in several places. The Dashboard reads it once
  (`useState(() => new Date())`) and passes it down.
