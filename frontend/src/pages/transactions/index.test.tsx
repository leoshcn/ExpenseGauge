import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";
import type { TransactionFilter } from "@/api/queries";

const tree: Schemas["CategoryTree"] = {
  account_id: 1,
  categories: [{ id: 1, name: "餐饮", children: [{ id: 11, name: "买菜", description: null }] }],
};

const requested: TransactionFilter[] = [];

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    accountsQuery: queryOptions({
      queryKey: actual.keys.accounts,
      queryFn: async (): Promise<Schemas["AccountOut"][]> => [{ id: 1, name: "日常账户", currency: "CNY" }],
    }),
    categoriesQuery: (accountId: number) =>
      queryOptions({ queryKey: actual.keys.categories(accountId), queryFn: async () => tree }),
    transactionPageQuery: (accountId: number, filter: TransactionFilter) =>
      queryOptions({
        queryKey: actual.keys.transactionPage(accountId, filter),
        queryFn: async (): Promise<Schemas["TransactionPage"]> => {
          requested.push(filter);
          return { items: [], page: filter.page, page_size: filter.pageSize, total: 0 };
        },
      }),
  };
});

const { TransactionsPage } = await import("./index");

describe("TransactionsPage", () => {
  it("drops a category from the URL that is not in the account before asking the API", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/transactions?category=999"]}>
          <TransactionsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText("还没有流水")).toBeInTheDocument();
    expect(requested.map((filter) => filter.categoryId)).toEqual([null]);
  });
});
