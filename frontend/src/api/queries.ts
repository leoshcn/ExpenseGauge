import { queryOptions } from "@tanstack/react-query";

import { api, ApiError, type Schemas, unwrap } from "./client";
import type { paths } from "./schema.gen";

/** A budget-account scope: one budget account's id, or `null` for all of them. */
export type BudgetScope = number | null;

/** How a scope appears in a query key ("all" rather than `null`, so keys stay readable). */
const scopeKey = (scope: BudgetScope) => (scope === null ? "all" : scope);

/** Query keys in one place, so invalidation never guesses at a key's shape. */
export const keys = {
  setupStatus: ["setup-status"] as const,
  me: ["me"] as const,
  /** The base currency. */
  settings: ["settings"] as const,
  budgetAccounts: ["budget-accounts"] as const,
  channels: ["channels"] as const,
  /**
   * Prefix of everything computed from the ledger (categories, summaries, transactions,
   * budgets): invalidating it refreshes every view of every scope.
   */
  ledger: ["ledger"] as const,
  categories: (scope: BudgetScope) => ["ledger", "categories", scopeKey(scope)] as const,
  /** Prefix of all Dashboard queries; invalidated by every change that moves a figure. */
  summaries: ["ledger", "summary"] as const,
  monthlySummary: (scope: BudgetScope, from: string, to: string) =>
    ["ledger", "summary", "monthly", scopeKey(scope), from, to] as const,
  monthDetail: (scope: BudgetScope, month: string) =>
    ["ledger", "summary", "month", scopeKey(scope), month] as const,
  /** Year to date through `month`; `null` scope = every annual budget account. */
  annualSummary: (scope: BudgetScope, month: string) =>
    ["ledger", "summary", "annual", scopeKey(scope), month] as const,
  transactions: ["ledger", "transactions"] as const,
  transactionPage: (filter: TransactionFilter) => ["ledger", "transactions", filter] as const,
  /** Payments a refund may be matched to (under `transactions`, so edits refresh them). */
  refundCandidates: (transactionId: number, q: string, page: number) =>
    ["ledger", "transactions", "refund-candidates", transactionId, q, page] as const,
  /** The refunds matched to one payment. */
  refunds: (transactionId: number) => ["ledger", "transactions", "refunds", transactionId] as const,
  budgets: ["ledger", "budgets"] as const,
  budgetsAt: (scope: BudgetScope, month: string) => ["ledger", "budgets", scopeKey(scope), month] as const,
  tokens: ["tokens"] as const,
};

/** The transaction list's query parameters; `null` means "not filtered". */
export type TransactionFilter = {
  month: string | null;
  channelId: number | null;
  budgetAccountId: number | null;
  categoryId: number | null;
  /** `"unmatched"`: only refunds without an original payment. */
  refundStatus: RefundStatus | null;
  page: number;
  pageSize: number;
};

/** The `refund_status` list filter, as the API declares it. */
export type RefundStatus = NonNullable<
  NonNullable<paths["/api/v1/transactions"]["get"]["parameters"]["query"]>["refund_status"]
>;

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

/** The base currency; `currency` is null until onboarding sets it. */
export const settingsQuery = queryOptions({
  queryKey: keys.settings,
  queryFn: () => unwrap(api.GET("/api/v1/settings")),
});

export const budgetAccountsQuery = queryOptions({
  queryKey: keys.budgetAccounts,
  queryFn: () => unwrap(api.GET("/api/v1/budget-accounts")),
});

export const channelsQuery = queryOptions({
  queryKey: keys.channels,
  queryFn: () => unwrap(api.GET("/api/v1/channels")),
});

/** The global tree, or only one budget account's level-2 categories and their parents. */
export const categoriesQuery = (scope: BudgetScope = null) =>
  queryOptions({
    queryKey: keys.categories(scope),
    queryFn: () =>
      unwrap(api.GET("/api/v1/categories", { params: { query: { budget_account_id: scope } } })),
  });

export const monthlySummaryQuery = (scope: BudgetScope, from: string, to: string) =>
  queryOptions({
    queryKey: keys.monthlySummary(scope, from, to),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/summary/monthly", {
          params: { query: { from, to, budget_account_id: scope } },
        }),
      ),
  });

export const monthDetailQuery = (scope: BudgetScope, month: string) =>
  queryOptions({
    queryKey: keys.monthDetail(scope, month),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/summary/months/{month}", {
          params: { path: { month }, query: { budget_account_id: scope } },
        }),
      ),
  });

/**
 * Annual budget accounts from January to the end of `month`: one (`scope`, which must be
 * annual) or all of them (`null`, possibly none).
 */
export const annualSummaryQuery = (scope: BudgetScope, month: string) =>
  queryOptions({
    queryKey: keys.annualSummary(scope, month),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/summary/annual/{month}", {
          params: { path: { month }, query: { budget_account_id: scope } },
        }),
      ),
  });

export const transactionPageQuery = (filter: TransactionFilter) =>
  queryOptions({
    queryKey: keys.transactionPage(filter),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/transactions", {
          params: {
            query: {
              month: filter.month,
              channel_id: filter.channelId,
              budget_account_id: filter.budgetAccountId,
              category_id: filter.categoryId,
              refund_status: filter.refundStatus,
              page: filter.page,
              page_size: filter.pageSize,
            },
          },
        }),
      ),
  });

/** The budget in force for each level-2 category (of the scope) in `month`. */
export const budgetsQuery = (scope: BudgetScope, month: string) =>
  queryOptions({
    queryKey: keys.budgetsAt(scope, month),
    queryFn: () =>
      unwrap(api.GET("/api/v1/budgets", { params: { query: { month, budget_account_id: scope } } })),
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

/** Sets the base currency. Only the label changes; no amount is converted. */
export const updateSettings = (body: Schemas["SettingsUpdateIn"]) =>
  unwrap(api.PUT("/api/v1/settings", { body }));

export const createBudgetAccount = (body: Schemas["BudgetAccountCreateIn"]) =>
  unwrap(api.POST("/api/v1/budget-accounts", { body }));

export const renameBudgetAccount = (budgetAccountId: number, body: Schemas["BudgetAccountUpdateIn"]) =>
  unwrap(
    api.PATCH("/api/v1/budget-accounts/{budget_account_id}", {
      params: { path: { budget_account_id: budgetAccountId } },
      body,
    }),
  );

export const createChannel = (body: Schemas["ChannelCreateIn"]) =>
  unwrap(api.POST("/api/v1/channels", { body }));

export const renameChannel = (channelId: number, body: Schemas["ChannelUpdateIn"]) =>
  unwrap(api.PATCH("/api/v1/channels/{channel_id}", { params: { path: { channel_id: channelId } }, body }));

/** A level-2 category (with `parent_id`) needs `budget_account_id`; a level-1 one must not have it. */
export const createCategory = (body: Schemas["CategoryCreateIn"]) =>
  unwrap(api.POST("/api/v1/categories", { body }));

/**
 * Only the fields present in `body` change; `description: null` removes the description,
 * `budget_account_id` moves a level-2 category (with its history) to another budget account.
 */
export const updateCategory = (categoryId: number, body: Schemas["CategoryUpdateIn"]) =>
  unwrap(api.PATCH("/api/v1/categories/{category_id}", { params: { path: { category_id: categoryId } }, body }));

/**
 * The complete new order of one sibling group: level 1 when `parent_id` is null, else that
 * level-1 category's children. Answers with the whole tree.
 */
export const reorderCategories = (body: Schemas["CategoryOrderIn"]) =>
  unwrap(api.PUT("/api/v1/categories/order", { body }));

export const deleteCategory = (categoryId: number) =>
  unwrap(api.DELETE("/api/v1/categories/{category_id}", { params: { path: { category_id: categoryId } } }));

/**
 * Only the fields present in `body` change; `note: null` removes the note. On a refund,
 * `refund_of_id` matches it to a payment (or another one), `null` removes the match; a
 * matched refund's category follows its payment and cannot be sent.
 */
export const updateTransaction = (transactionId: number, body: Schemas["TransactionUpdateIn"]) =>
  unwrap(
    api.PATCH("/api/v1/transactions/{transaction_id}", {
      params: { path: { transaction_id: transactionId } },
      body,
    }),
  );

/**
 * Payments the refund `transactionId` may be matched to: dated on or before it, with
 * enough left to refund; same channel and counterparty first. `q` searches counterparty
 * and description.
 */
export const refundCandidatesQuery = (transactionId: number, q: string, page = 1) =>
  queryOptions({
    queryKey: keys.refundCandidates(transactionId, q, page),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/transactions/{transaction_id}/refund-candidates", {
          params: {
            path: { transaction_id: transactionId },
            query: { q: q || null, page, page_size: REFUND_CANDIDATES_PAGE_SIZE },
          },
        }),
      ),
  });

export const REFUND_CANDIDATES_PAGE_SIZE = 20;

/** The refunds matched to the payment `transactionId`, oldest first. */
export const refundsQuery = (transactionId: number) =>
  queryOptions({
    queryKey: keys.refunds(transactionId),
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/transactions/{transaction_id}/refunds", {
          params: { path: { transaction_id: transactionId } },
        }),
      ),
  });

/** Refused with 409 `TRANSACTION_HAS_REFUNDS` for a payment that refunds still point at. */
export const deleteTransaction = (transactionId: number) =>
  unwrap(
    api.DELETE("/api/v1/transactions/{transaction_id}", {
      params: { path: { transaction_id: transactionId } },
    }),
  );

/** Sets each item from `effective_from` on; an `amount` of null clears that budget. */
export const putBudgets = (body: Schemas["BudgetsPutIn"]) => unwrap(api.PUT("/api/v1/budgets", { body }));

export const createToken = (body: Schemas["TokenCreateIn"]) => unwrap(api.POST("/api/v1/tokens", { body }));

export const revokeToken = (tokenId: number) =>
  unwrap(api.DELETE("/api/v1/tokens/{token_id}", { params: { path: { token_id: tokenId } } }));
