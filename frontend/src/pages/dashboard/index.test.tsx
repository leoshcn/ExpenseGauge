import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";
import type { BudgetScope } from "@/api/queries";
import { addMonths, monthRange } from "@/lib/month";

const daily: Schemas["BudgetAccountOut"] = { id: 1, name: "日常", period: "month" };
const yearly: Schemas["BudgetAccountOut"] = { id: 3, name: "年度", period: "year" };

const state: { accounts: Schemas["BudgetAccountOut"][]; annualActual: string } = {
  accounts: [daily, yearly],
  annualActual: "8000.00",
};
const annualRequests: { scope: BudgetScope; month: string }[] = [];
const detailRequests: string[] = [];
const putBudgets = vi.fn(async (body: Schemas["BudgetsPutIn"]) => {
  void body;
  return { budget_account_id: null, currency: "CNY", month: "2026-10", budgets: [] };
});

const food: Schemas["Level1Row"] = {
  category_id: 10,
  name: "餐饮",
  budget: "6000.00",
  actual: "5000.00",
  count: 42,
  children: [{ category_id: 11, name: "买菜", budget: "6000.00", actual: "5000.00", count: 42 }],
};

/** "全部" leaves the annual account's 6000 out of `actual` and reports it apart. */
const monthTotal = (month: string): Schemas["MonthTotal"] => ({
  month,
  budget: "6000.00",
  actual: "5000.00",
  annual_actual: state.accounts.some((account) => account.period === "year") ? "6000.00" : "0.00",
});

const annualAccount = (): Schemas["AnnualAccount"] => ({
  budget_account_id: yearly.id,
  name: yearly.name,
  budget: "30000.00",
  actual: state.annualActual,
  count: 2,
  months: [
    { month: "2026-01", actual: "6000.00" },
    { month: "2026-02", actual: "0.00" },
    { month: "2026-03", actual: (Number(state.annualActual) - 6000).toFixed(2) },
  ],
  categories: [
    {
      category_id: 20,
      name: "出行",
      budget: "30000.00",
      actual: state.annualActual,
      count: 2,
      children: [{ category_id: 21, name: "旅行", budget: "30000.00", actual: state.annualActual, count: 2 }],
    },
  ],
});

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    budgetAccountsQuery: queryOptions({
      queryKey: actual.keys.budgetAccounts,
      queryFn: async () => state.accounts,
    }),
    monthlySummaryQuery: (scope: BudgetScope, from: string, to: string) =>
      queryOptions({
        queryKey: actual.keys.monthlySummary(scope, from, to),
        queryFn: async (): Promise<Schemas["MonthlySummaryOut"]> => ({
          budget_account_id: scope,
          currency: "CNY",
          months: monthRange(from, to).map(monthTotal),
        }),
      }),
    monthDetailQuery: (scope: BudgetScope, month: string) =>
      queryOptions({
        queryKey: actual.keys.monthDetail(scope, month),
        queryFn: async (): Promise<Schemas["MonthDetailOut"]> => {
          detailRequests.push(month);
          return {
            ...monthTotal(month),
            count: 42,
            budget_account_id: scope,
            currency: "CNY",
            rollover_available: null,
            categories: [food],
          };
        },
      }),
    annualSummaryQuery: (scope: BudgetScope, month: string) =>
      queryOptions({
        queryKey: actual.keys.annualSummary(scope, month),
        queryFn: async (): Promise<Schemas["AnnualSummaryOut"]> => {
          annualRequests.push({ scope, month });
          return { currency: "CNY", year: Number(month.slice(0, 4)), through: month, accounts: [annualAccount()] };
        },
      }),
    scheduleStatusQuery: (scope: BudgetScope, month: string) =>
      queryOptions({
        queryKey: actual.keys.scheduleStatus(scope, month),
        queryFn: async (): Promise<Schemas["ScheduleStatusOut"]> => ({ month, items: [], forecast: null }),
      }),
    putBudgets: (body: Schemas["BudgetsPutIn"]) => putBudgets(body),
    insightQuery: (month: string) =>
      queryOptions({
        queryKey: actual.keys.insight(month),
        queryFn: async (): Promise<Schemas["InsightStateOut"]> => ({
          month,
          configured: false,
          insight: null,
          stale: false,
        }),
      }),
  };
});

const { DashboardPage } = await import("./index");

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("DashboardPage", () => {
  beforeAll(() => {
    // Only the clock: the page reads "now" once; timers stay real for Testing Library.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 12));
  });
  afterAll(() => vi.useRealTimers());

  beforeEach(() => {
    state.accounts = [daily, yearly];
    state.annualActual = "8000.00";
    annualRequests.length = 0;
    detailRequests.length = 0;
    putBudgets.mockClear();
  });

  it("shows the budget grid of the month and the two before it and saves a budget from a month on", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard?month=2026-09");
    await screen.findByRole("heading", { name: "预算执行" });
    expect([...detailRequests].sort()).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(screen.queryByRole("heading", { name: "分类明细" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /环形图/ })).not.toBeInTheDocument();

    // jsdom matches no width query: the phone layout shows the selected month only.
    await user.click(screen.getByRole("button", { name: "修改「买菜」2026年9月的预算" }));
    await user.keyboard("{Control>}a{/Control}6500{Enter}");
    expect(putBudgets).toHaveBeenCalledWith({ effective_from: "2026-09", items: [{ category_id: 11, amount: "6500.00" }] });
    // Later months may follow the change: the months are fetched again.
    await vi.waitFor(() => expect(detailRequests.filter((month) => month === "2026-09")).toHaveLength(2));
  });

  it("keeps annual spending out of the monthly comparison in 全部 and lists annual accounts apart", async () => {
    renderAt("/dashboard");
    const summary = await screen.findByRole("region", { name: "2026年10月" });
    expect(within(summary).getByText("¥5,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("另有年度开支 ¥6,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("42 笔消费")).toBeInTheDocument();

    const card = screen.getByRole("heading", { name: /^年度预算/ }).closest("section")!;
    // Folded: one line per account.
    expect(within(card).getByText("¥8,000.00 / ¥30,000.00")).toBeInTheDocument();
    expect(within(card).queryByRole("meter")).not.toBeInTheDocument();
    await userEvent.setup().click(within(card).getByRole("button", { name: /^年度预算/ }));
    expect(within(card).getByText("年初至今 2 笔消费")).toBeInTheDocument();
    expect(within(card).getByRole("meter", { name: "「年度」年度预算使用进度" })).toBeInTheDocument();
    expect(annualRequests).toEqual([{ scope: null, month: "2026-10" }]);
  });

  it("opens an annual account's view from the annual card", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard?month=2026-03");
    await user.click(await screen.findByRole("button", { name: "查看「年度」" }));
    expect(await screen.findByRole("region", { name: "截至2026年3月" })).toBeInTheDocument();
    expect(annualRequests).toContainEqual({ scope: 3, month: "2026-03" });
  });

  it("opens a future month to plan its budgets, without an AI insight", async () => {
    const user = userEvent.setup();
    renderAt("/dashboard?month=2026-12");
    expect(await screen.findByRole("region", { name: "2026年12月" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2026年12月" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("heading", { name: "AI 洞察" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "修改「买菜」2026年12月的预算" }));
    await user.keyboard("{Control>}a{/Control}7000{Enter}");
    expect(putBudgets).toHaveBeenCalledWith({ effective_from: "2026-12", items: [{ category_id: 11, amount: "7000.00" }] });

    // Beyond 12 months ahead the URL's month is not honoured.
    cleanup();
    renderAt("/dashboard?month=2027-11");
    expect(await screen.findByRole("region", { name: "2026年10月" })).toBeInTheDocument();
  });

  it("offers the AI insight in 全部 only", async () => {
    renderAt("/dashboard?month=2026-09");
    expect(await screen.findByRole("heading", { name: "AI 洞察" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "去设置" })).toHaveAttribute("href", "/settings?tab=ai");

    cleanup();
    renderAt("/dashboard?scope=1&month=2026-09");
    expect(await screen.findByRole("region", { name: "2026年9月" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "AI 洞察" })).not.toBeInTheDocument();
  });

  it("looks as before with monthly budget accounts only", async () => {
    state.accounts = [daily];
    renderAt("/dashboard");
    const summary = await screen.findByRole("region", { name: "2026年10月" });
    expect(within(summary).queryByText(/另有年度开支/)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^年度预算/ })).not.toBeInTheDocument();
    expect(annualRequests).toEqual([]);
  });

  it("shows an annual account's year to date against its budget, with whole months as time progress", async () => {
    renderAt("/dashboard?scope=3&month=2026-03");
    const summary = await screen.findByRole("region", { name: "截至2026年3月" });
    expect(within(summary).getByText("¥8,000.00")).toBeInTheDocument();
    expect(within(summary).getByText("年初至今 2 笔消费")).toBeInTheDocument();
    expect(within(summary).getByText("已用 27%")).toBeInTheDocument();
    expect(within(summary).getByText("全年已过 25%")).toBeInTheDocument();
    expect(within(summary).getByText("¥22,000.00")).toBeInTheDocument();
    expect(within(summary).queryByText("超支")).not.toBeInTheDocument();
    // The category table and share chart read the same year to date.
    expect(screen.getByRole("columnheader", { name: "年度预算" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "年初至今" })).toBeInTheDocument();
    expect(screen.getByText("按一级分类，年初至今")).toBeInTheDocument();
    expect(annualRequests).toEqual([{ scope: 3, month: "2026-03" }]);
  });

  it("marks an annual account over budget only once the year to date exceeds it", async () => {
    state.annualActual = "31000.00";
    renderAt(`/dashboard?scope=3&month=${addMonths("2026-10", -7)}`);
    const summary = await screen.findByRole("region", { name: "截至2026年3月" });
    expect(within(summary).getByText("超支")).toBeInTheDocument();
    expect(within(summary).getByText("¥1,000.00")).toBeInTheDocument();
  });
});
