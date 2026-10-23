import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";
import type { BudgetScope, ReportGroupBy } from "@/api/queries";

const daily = { id: 1, name: "日常", period: "month" as const };
const summaries: { groupBy: ReportGroupBy; from: string; to: string; scope: BudgetScope }[] = [];
const saveReport = vi.fn(async (body: Schemas["SavedReportIn"]) => ({ id: 9, ...body }));

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    budgetAccountsQuery: queryOptions({ queryKey: actual.keys.budgetAccounts, queryFn: async () => [daily] }),
    savedReportsQuery: queryOptions({
      queryKey: actual.keys.savedReports,
      queryFn: async (): Promise<Schemas["SavedReportOut"][]> => [],
    }),
    reportSummaryQuery: (groupBy: ReportGroupBy, from: string, to: string, scope: BudgetScope) =>
      queryOptions({
        queryKey: actual.keys.reportSummary(groupBy, from, to, scope),
        queryFn: async (): Promise<Schemas["ReportOut"]> => {
          summaries.push({ groupBy, from, to, scope });
          return {
            currency: "CNY",
            group_by: groupBy,
            months: ["2026-08", "2026-09", "2026-10"],
            groups: [
              { key: "国庆", label: "国庆", amount: "300.00", count: 1, months: ["0.00", "300.00", "0.00"] },
              { key: null, label: null, amount: "56.00", count: 2, months: ["50.00", "0.00", "6.00"] },
            ],
            total: { amount: "356.00", count: 3, months: ["50.00", "300.00", "6.00"] },
            overlapping: true,
          };
        },
      }),
    reportDailyQuery: (from: string, to: string, scope: BudgetScope) =>
      queryOptions({
        queryKey: actual.keys.reportDaily(from, to, scope),
        queryFn: async (): Promise<Schemas["DailyOut"]> => ({
          currency: "CNY",
          days: [{ date: "2026-10-02", amount: "88.00" }],
          budgets: [{ month: "2026-10", budget: "1000.00" }],
        }),
      }),
    saveReport,
  };
});

const { ReportsPage } = await import("./index");

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("ReportsPage", () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 23, 12));
  });
  afterAll(() => vi.useRealTimers());

  it("asks for the URL's grouping and range and lists every group with the total", async () => {
    renderAt("/reports?group=tag&range=last_3");
    const table = await screen.findByRole("table");
    expect(summaries.at(-1)).toEqual({ groupBy: "tag", from: "2026-08", to: "2026-10", scope: null });
    expect(within(table).getByRole("rowheader", { name: "#国庆" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "无标签" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "合计" }).closest("tr")).toHaveTextContent("¥356.00");
    expect(screen.getByText(/各组相加会大于合计/)).toBeInTheDocument();
  });

  it("saves the current settings under a name", async () => {
    const user = userEvent.setup();
    renderAt("/reports?group=tag&mode=monthly");
    await user.click(await screen.findByRole("button", { name: "保存" }));
    await user.type(screen.getByRole("textbox", { name: "报表名称" }), "旅行标签");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "保存" }));
    expect(saveReport).toHaveBeenCalledWith({
      name: "旅行标签",
      config: {
        group_by: "tag",
        mode: "monthly",
        range: { preset: "last_3", from_month: null, to_month: null },
        budget_account_id: null,
        chart: "bar",
      },
    });
  });

  it("links each calendar day to that day's transactions", async () => {
    renderAt("/reports?tab=calendar");
    const day = await screen.findByRole("link", { name: "10月2日：¥88.00" });
    expect(day).toHaveAttribute("href", "/transactions?from=2026-10-02&to=2026-10-02");
    expect(screen.getByText("本月合计 ¥88.00")).toBeInTheDocument();
  });
});
