import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";

import { accountsQuery } from "@/api/queries";

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
 * The accounts and the one chosen by `?account=<id>`, falling back to the first account
 * when the parameter is missing or unknown (the same rule as the Dashboard).
 */
export function useSelectedAccount() {
  const { params, update } = useSearchState();
  const accounts = useQuery(accountsQuery);
  const account =
    accounts.data?.find((candidate) => String(candidate.id) === params.get("account")) ??
    accounts.data?.[0];
  return { accounts, account, params, update };
}
