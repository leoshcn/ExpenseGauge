import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";
import type { BudgetScope } from "@/api/queries";

const daily = { id: 1, name: "日常", period: "month" as const };

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [{ id: 1, name: "餐饮", children: [{ id: 11, name: "买菜", description: null, budget_account: daily, rollover_from: null }] }],
};

const budgets = (scope: BudgetScope, month: string, amount: string | null): Schemas["BudgetsOut"] => ({
  budget_account_id: scope,
  currency: "CNY",
  month,
  budgets: [
    {
      category_id: 11,
      category_name: "买菜",
      parent_id: 1,
      parent_name: "餐饮",
      budget_account_id: daily.id,
      budget_account_name: daily.name,
      period: "month",
      amount,
      effective_from: amount === null ? null : month,
      reference_last: "0.00",
      reference_avg3: "0.00",
      rollover_from: null,
      carry_in: null,
    },
  ],
});

const requested: { scope: BudgetScope; month: string }[] = [];

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    budgetAccountsQuery: queryOptions({
      queryKey: actual.keys.budgetAccounts,
      queryFn: async (): Promise<Schemas["BudgetAccountOut"][]> => [daily, { id: 2, name: "固定", period: "month" }],
    }),
    categoriesQuery: (scope: BudgetScope = null) =>
      queryOptions({ queryKey: actual.keys.categories(scope), queryFn: async () => tree }),
    // March loads; April never answers, so the page keeps showing March as placeholder.
    budgetsQuery: (scope: BudgetScope, month: string) =>
      queryOptions({
        queryKey: actual.keys.budgetsAt(scope, month),
        queryFn: () => {
          requested.push({ scope, month });
          return month === "2026-03"
            ? Promise.resolve(budgets(scope, month, "500.00"))
            : new Promise<Schemas["BudgetsOut"]>(() => {});
        },
      }),
    putBudgets: vi.fn(),
  };
});

const { BudgetsPage } = await import("./index");

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <BudgetsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("BudgetsPage", () => {
  beforeEach(() => {
    requested.length = 0;
  });

  it("does not save while the chosen month's amounts are still loading", async () => {
    const user = userEvent.setup();
    renderAt("/budgets?month=2026-03");

    const input = await screen.findByRole("textbox", { name: "「买菜」的预算金额" });
    await user.clear(input);
    await user.type(input, "600");
    expect(screen.getByRole("button", { name: "保存预算" })).toBeEnabled();

    // April is shown in the save bar, but the diff is still against March's 500.
    await user.click(screen.getByRole("button", { name: "下一个月" }));
    expect(screen.getByText(/从 2026年4月 起生效/, { selector: "span" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存预算" })).toBeDisabled();
  });

  it("shows all budget accounts by default and one from the URL; an unknown one means all", async () => {
    renderAt("/budgets?month=2026-03");
    expect(await screen.findByRole("combobox", { name: "预算账户" })).toHaveTextContent("全部");
    // In "全部" each row names its budget account.
    expect(await screen.findByText("日常")).toBeInTheDocument();

    renderAt("/budgets?month=2026-03&scope=2");
    renderAt("/budgets?month=2026-03&scope=999");
    await waitFor(() => expect(screen.getAllByRole("textbox", { name: "「买菜」的预算金额" })).toHaveLength(3));
    const scopes = requested.map((entry) => String(entry.scope));
    expect(scopes.sort()).toEqual(["2", "null", "null"]);
  });
});
