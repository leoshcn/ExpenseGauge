import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";
import type { TransactionFilter } from "@/api/queries";

const daily = { id: 1, name: "日常", period: "month" as const };

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [{ id: 1, name: "餐饮", children: [{ id: 11, name: "买菜", description: null, budget_account: daily }] }],
};

const transaction: Schemas["TransactionOut"] = {
  id: 100,
  date: "2026-10-03",
  amount: "35.50",
  counterparty: "盒马鲜生",
  description: "",
  note: null,
  category_id: 11,
  category_name: "买菜",
  parent_category_id: 1,
  parent_category_name: "餐饮",
  channel_id: 5,
  channel_name: "招商储蓄卡",
  budget_account_id: daily.id,
  budget_account_name: daily.name,
  confirmed_duplicate: false,
  created_at: "2026-10-03T10:00:00Z",
};

const requested: TransactionFilter[] = [];
let rows: Schemas["TransactionOut"][] = [];

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    settingsQuery: queryOptions({ queryKey: actual.keys.settings, queryFn: async () => ({ currency: "CNY" }) }),
    budgetAccountsQuery: queryOptions({ queryKey: actual.keys.budgetAccounts, queryFn: async () => [daily] }),
    channelsQuery: queryOptions({
      queryKey: actual.keys.channels,
      queryFn: async (): Promise<Schemas["ChannelOut"][]> => [{ id: 5, name: "招商储蓄卡" }],
    }),
    categoriesQuery: () => queryOptions({ queryKey: actual.keys.categories(null), queryFn: async () => tree }),
    transactionPageQuery: (filter: TransactionFilter) =>
      queryOptions({
        queryKey: actual.keys.transactionPage(filter),
        queryFn: async (): Promise<Schemas["TransactionPage"]> => {
          requested.push(filter);
          return { items: rows, page: filter.page, page_size: filter.pageSize, total: rows.length };
        },
      }),
  };
});

const { TransactionsPage } = await import("./index");

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TransactionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("TransactionsPage", () => {
  beforeEach(() => {
    requested.length = 0;
    rows = [];
  });

  it("drops ids from the URL that do not exist before asking the API", async () => {
    renderAt("/transactions?category=999&channel=998&budget_account=997");
    expect(await screen.findByText("还没有流水")).toBeInTheDocument();
    expect(requested.map(({ categoryId, channelId, budgetAccountId }) => [categoryId, channelId, budgetAccountId])).toEqual([
      [null, null, null],
    ]);
  });

  it("passes known filters to the API and shows each row's channel", async () => {
    rows = [transaction];
    renderAt("/transactions?channel=5&budget_account=1&category=1");
    expect(await screen.findAllByText("招商储蓄卡")).not.toHaveLength(0);
    expect(screen.getByRole("columnheader", { name: "渠道" })).toBeInTheDocument();
    expect(requested).toEqual([
      expect.objectContaining({ channelId: 5, budgetAccountId: 1, categoryId: 1, month: null, page: 1 }),
    ]);
  });
});
