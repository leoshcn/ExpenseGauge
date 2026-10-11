import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { budgetAccountsQuery, type BudgetScope } from "@/api/queries";

/**
 * The page's view state in the URL. `update` merges: a key set to `null` is removed,
 * keys not mentioned are kept. History is replaced, not pushed, so stepping through
 * filters does not fill the back button.
 */
export function useSearchState() {
  const [params, setParams] = useSearchParams();
  function update(next: Record<string, string | number | null>) {
    setParams(
      (current) => {
        const merged = new URLSearchParams(current);
        for (const [key, value] of Object.entries(next)) {
          if (value === null) merged.delete(key);
          else merged.set(key, String(value));
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
