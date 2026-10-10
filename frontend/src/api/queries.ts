import { queryOptions } from "@tanstack/react-query";

import { api, ApiError, type Schemas, unwrap } from "./client";

/** Query keys in one place, so invalidation never guesses at a key's shape. */
export const keys = {
  setupStatus: ["setup-status"] as const,
  me: ["me"] as const,
  accounts: ["accounts"] as const,
  categories: (accountId: number) => ["accounts", accountId, "categories"] as const,
  monthlySummary: (accountId: number, from: string, to: string) =>
    ["accounts", accountId, "summary", "monthly", from, to] as const,
  monthDetail: (accountId: number, month: string) =>
    ["accounts", accountId, "summary", "month", month] as const,
};

export const setupStatusQuery = queryOptions({
  queryKey: keys.setupStatus,
  queryFn: () => unwrap(api.GET("/api/v1/setup/status")),
  staleTime: Infinity,
});

/** The signed-in user, or null when there is no valid session. */
export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: async (): Promise<Schemas["UserOut"] | null> => {
    try {
      return await unwrap(api.GET("/api/v1/auth/me"));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  },
  staleTime: Infinity,
});

export const accountsQuery = queryOptions({
  queryKey: keys.accounts,
  queryFn: () => unwrap(api.GET("/api/v1/accounts")),
});

export const categoriesQuery = (accountId: number) =>
  queryOptions({
    queryKey: keys.categories(accountId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/accounts/{account_id}/categories", {
          params: { path: { account_id: accountId } },
        }),
      ),
  });

export const monthlySummaryQuery = (accountId: number, from: string, to: string) =>
  queryOptions({
    queryKey: keys.monthlySummary(accountId, from, to),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/accounts/{account_id}/summary/monthly", {
          params: { path: { account_id: accountId }, query: { from, to } },
        }),
      ),
  });

export const monthDetailQuery = (accountId: number, month: string) =>
  queryOptions({
    queryKey: keys.monthDetail(accountId, month),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/accounts/{account_id}/summary/months/{month}", {
          params: { path: { account_id: accountId, month } },
        }),
      ),
  });

// Requests behind mutations. Pages wrap them in `useMutation`.

export const createFirstUser = (body: Schemas["CredentialsIn"]) =>
  unwrap(api.POST("/api/v1/setup", { body }));

export const login = (body: Schemas["LoginIn"]) => unwrap(api.POST("/api/v1/auth/login", { body }));

export const logout = () => unwrap(api.POST("/api/v1/auth/logout"));

export const createAccount = (body: Schemas["AccountCreateIn"]) =>
  unwrap(api.POST("/api/v1/accounts", { body }));

export const createCategory = (accountId: number, body: Schemas["CategoryCreateIn"]) =>
  unwrap(
    api.POST("/api/v1/accounts/{account_id}/categories", {
      params: { path: { account_id: accountId } },
      body,
    }),
  );
