import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { budgetAccountsQuery, type BudgetScope } from "@/api/queries";

/**
 * The page's view state in the URL. `update` merges: a key set to `null` (or an empty
 * list) is removed, a list is written as repeated keys (`?tag=a&tag=b`), keys not
 * mentioned are kept. History is replaced, not pushed, so stepping through filters does
 * not fill the back button.
 */
export function useSearchState() {
  const [params, setParams] = useSearchParams();
  function update(next: Record<string, string | number | readonly string[] | null>) {
    setParams(
      (current) => {
        const merged = new URLSearchParams(current);
        for (const [key, value] of Object.entries(next)) {
          merged.delete(key);
          if (Array.isArray(value)) value.forEach((item: string) => merged.append(key, item));
          else if (value !== null) merged.set(key, String(value));
        }
        return merged;
      },
      { replace: true },
    );
  }
  return { params, update };
}

/**
 * The budget accounts and the scope chosen by `?scope=<id>`: that budget account, or
 * `null` ("全部") when the parameter is missing, `all` or not a known budget account.
 * `scope` is `undefined` until the budget accounts are loaded, so an unknown id never
 * reaches the API.
 */
export function useBudgetScope() {
  const { params, update } = useSearchState();
  const budgetAccounts = useQuery(budgetAccountsQuery);
  const requested = params.get("scope");
  let scope: BudgetScope | undefined;
  if (budgetAccounts.data) {
    scope = budgetAccounts.data.find((candidate) => String(candidate.id) === requested)?.id ?? null;
  }
  return { budgetAccounts, scope, params, update };
}
