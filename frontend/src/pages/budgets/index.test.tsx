import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

const tree: Schemas["CategoryTree"] = {
  account_id: 1,
  categories: [{ id: 1, name: "餐饮", children: [{ id: 11, name: "买菜", description: null }] }],
};

const budgets = (month: string, amount: string | null): Schemas["BudgetsOut"] => ({
  account_id: 1,
  currency: "CNY",
  month,
  budgets: [
    {
      category_id: 11,
      category_name: "买菜",
      parent_id: 1,
      parent_name: "餐饮",
      amount,
      effective_from: amount === null ? null : month,
    },
  ],
});

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
    // March loads; April never answers, so the page keeps showing March as placeholder.
    budgetsQuery: (accountId: number, month: string) =>
      queryOptions({
        queryKey: actual.keys.budgetsAt(accountId, month),
        queryFn: () =>
          month === "2026-03"
            ? Promise.resolve(budgets(month, "500.00"))
            : new Promise<Schemas["BudgetsOut"]>(() => {}),
      }),
    putBudgets: vi.fn(),
  };
});

const { BudgetsPage } = await import("./index");

describe("BudgetsPage", () => {
  it("does not save while the chosen month's amounts are still loading", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/budgets?month=2026-03"]}>
          <BudgetsPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const input = await screen.findByRole("textbox", { name: "「买菜」的预算金额" });
    await user.clear(input);
    await user.type(input, "600");
    expect(screen.getByRole("button", { name: "保存预算" })).toBeEnabled();

    // April is shown in the save bar, but the diff is still against March's 500.
    await user.click(screen.getByRole("button", { name: "下一个月" }));
    expect(screen.getByText(/从 2026年4月 起生效/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存预算" })).toBeDisabled();
  });
});
