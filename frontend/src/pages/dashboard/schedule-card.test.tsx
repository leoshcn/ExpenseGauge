import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { ScheduleCard } from "./schedule-card";

const schedule = (id: number, name: string, keyword: string): Schemas["ScheduleOut"] => ({
  id,
  name,
  keyword,
  category_id: 11,
  category_name: "房租",
  parent_category_name: "居住",
  budget_account_id: 2,
  budget_account_name: "固定",
  amount: "6500.00",
  approximate: false,
  frequency: "month",
  day: 1,
  month_of_year: null,
  start_month: "2026-01",
  active: true,
});

const status: Schemas["ScheduleStatusOut"] = {
  month: "2026-10",
  forecast: { actual: "1000.00", outstanding: "6500.00", projected: "7500.00" },
  items: [
    { schedule: schedule(1, "房租", "自如"), due_date: "2026-10-01", status: "overdue", transaction: null },
    { schedule: { ...schedule(2, "宽带", "电信"), amount: "99.00", day: 28 }, due_date: "2026-10-28", status: "pending", transaction: null },
  ],
};

describe("ScheduleCard", () => {
  it("lists each schedule with its state; an overdue one links to a search", () => {
    render(
      <MemoryRouter>
        <ScheduleCard status={status} currency="CNY" now={new Date(2026, 9, 23)} />
      </MemoryRouter>,
    );
    expect(screen.getByText("已到账 0 · 待到账 1 · 逾期 1")).toBeInTheDocument();
    const rent = screen.getByText("房租").closest("li")!;
    expect(within(rent).getByRole("link", { name: /逾期未到账/ })).toHaveAttribute(
      "href",
      `/transactions?q=${encodeURIComponent("自如")}`,
    );
    expect(within(rent).getByText(/应于10月1日 · 每月1日/)).toBeInTheDocument();
    const broadband = screen.getByText("宽带").closest("li")!;
    expect(within(broadband).getByText("待到账")).toBeInTheDocument();
    expect(within(broadband).getByText("¥99.00")).toBeInTheDocument();
  });
});
