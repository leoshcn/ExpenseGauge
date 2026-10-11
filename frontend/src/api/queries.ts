import { queryOptions } from "@tanstack/react-query";

import { api, ApiError, type Schemas, unwrap } from "./client";

/** Query keys in one place, so invalidation never guesses at a key's shape. */
export const keys = {
  setupStatus: ["setup-status"] as const,
  me: ["me"] as const,
  /** Also the prefix of everything below: invalidating it refreshes every account's data. */
  accounts: ["accounts"] as const,
  /** Prefix of all data of one account (categories, summaries, transactions, budgets). */
  account: (accountId: number) => ["accounts", accountId] as const,
  categories: (accountId: number) => ["accounts", accountId, "categories"] as const,
  /** Prefix of both Dashboard queries; invalidated by every change that moves a figure. */
  summaries: (accountId: number) => ["accounts", accountId, "summary"] as const,
  monthlySummary: (accountId: number, from: string, to: string) =>
    ["accounts", accountId, "summary", "monthly", from, to] as const,
  monthDetail: (accountId: number, month: string) =>
    ["accounts", accountId, "summary", "month", month] as const,
  transactions: (accountId: number) => ["accounts", accountId, "transactions"] as const,
  transactionPage: (accountId: number, filter: TransactionFilter) =>
    ["accounts", accountId, "transactions", filter] as const,
  budgets: (accountId: number) => ["accounts", accountId, "budgets"] as const,
  budgetsAt: (accountId: number, month: string) => ["accounts", accountId, "budgets", month] as const,
  tokens: ["tokens"] as const,
};

/** The transaction list's query parameters; `null` means "not filtered". */
export type TransactionFilter = {
  month: string | null;
  categoryId: number | null;
  page: number;
  pageSize: number;
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

export const transactionPageQuery = (accountId: number, filter: TransactionFilter) =>
  queryOptions({
    queryKey: keys.transactionPage(accountId, filter),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/accounts/{account_id}/transactions", {
          params: {
            path: { account_id: accountId },
            query: {
              month: filter.month,
              category_id: filter.categoryId,
              page: filter.page,
              page_size: filter.pageSize,
            },
          },
        }),
      ),
  });

/** The budget in force for each level-2 category in `month`. */
export const budgetsQuery = (accountId: number, month: string) =>
  queryOptions({
    queryKey: keys.budgetsAt(accountId, month),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/accounts/{account_id}/budgets", {
          params: { path: { account_id: accountId }, query: { month } },
        }),
      ),
  });

export const tokensQuery = queryOptions({
  queryKey: keys.tokens,
  queryFn: () => unwrap(api.GET("/api/v1/tokens")),
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

export const renameAccount = (accountId: number, body: Schemas["AccountUpdateIn"]) =>
  unwrap(api.PATCH("/api/v1/accounts/{account_id}", { params: { path: { account_id: accountId } }, body }));

/** Only the fields present in `body` change; `description: null` removes the description. */
export const updateCategory = (categoryId: number, body: Schemas["CategoryUpdateIn"]) =>
  unwrap(api.PATCH("/api/v1/categories/{category_id}", { params: { path: { category_id: categoryId } }, body }));

export const deleteCategory = (categoryId: number) =>
  unwrap(api.DELETE("/api/v1/categories/{category_id}", { params: { path: { category_id: categoryId } } }));

/** Only the fields present in `body` change; `note: null` removes the note. */
export const updateTransaction = (transactionId: number, body: Schemas["TransactionUpdateIn"]) =>
  unwrap(
    api.PATCH("/api/v1/transactions/{transaction_id}", {
      params: { path: { transaction_id: transactionId } },
      body,
    }),
  );

export const deleteTransaction = (transactionId: number) =>
  unwrap(
    api.DELETE("/api/v1/transactions/{transaction_id}", {
      params: { path: { transaction_id: transactionId } },
    }),
  );

/** Sets each item from `effective_from` on; an `amount` of null clears that budget. */
export const putBudgets = (accountId: number, body: Schemas["BudgetsPutIn"]) =>
  unwrap(api.PUT("/api/v1/accounts/{account_id}/budgets", { params: { path: { account_id: accountId } }, body }));

export const createToken = (body: Schemas["TokenCreateIn"]) => unwrap(api.POST("/api/v1/tokens", { body }));

export const revokeToken = (tokenId: number) =>
  unwrap(api.DELETE("/api/v1/tokens/{token_id}", { params: { path: { token_id: tokenId } } }));
