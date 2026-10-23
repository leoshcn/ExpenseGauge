import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, type Schemas } from "@/api/client";

import { BudgetGrid } from "./budget-grid";

const detail = (
  month: string,
  lunch: { budget: string | null; actual: string; carry_in?: string | null },
): Schemas["MonthDetailOut"] => ({
  budget_account_id: null,
  currency: "CNY",
  month,
  budget: lunch.budget,
  actual: (Number(lunch.actual) + 100).toFixed(2),
  count: 3,
  annual_actual: "0.00",
  rollover_available: null,
  categories: [
    {
      category_id: 10,
      name: "餐饮",
      budget: lunch.budget,
      actual: (Number(lunch.actual) + 100).toFixed(2),
      count: 3,
      children: [
        { category_id: 11, name: "午餐", budget: lunch.budget, actual: lunch.actual, count: 2, carry_in: lunch.carry_in ?? null },
        { category_id: 12, name: "早餐", budget: null, actual: "100.00", count: 1 },
      ],
    },
  ],
});

const details = [
  detail("2026-08", { budget: "1500.00", actual: "1200.00" }),
  detail("2026-09", { budget: "1500.00", actual: "1700.00" }),
  detail("2026-10", { budget: "1500.00", actual: "300.00", carry_in: "300.00" }),
];

/** jsdom has no layout: say which width queries match. */
function width(px: number) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: Number(/min-width: ([\d.]+)rem/.exec(query)?.[1] ?? 0) * 16 <= px,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function renderGrid(onSave = vi.fn(async () => undefined)) {
  render(
    <MemoryRouter>
      <BudgetGrid details={details} current="2026-10" onSave={onSave} />
    </MemoryRouter>,
  );
  return onSave;
}

const row = (name: string) => screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;

describe("BudgetGrid", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows the selected month and the two before it on a wide screen, with totals", () => {
    width(1440);
    renderGrid();
    expect(screen.getAllByRole("columnheader", { name: /^2026年\d+月/ }).map((cell) => cell.textContent)).toEqual([
      "2026年8月",
      "2026年9月",
      "2026年10月本月",
    ]);
    const total = within(row("合计"));
    expect(total.getAllByText("1,500.00")).toHaveLength(3);
    expect(total.getByText("1,800.00")).toBeInTheDocument();
    // Over budget reads as such without colour.
    const lunch = row("午餐");
    expect(within(lunch).getByText("超支")).toBeInTheDocument();
    expect(within(lunch).getByText("-200.00")).toBeInTheDocument();
    // A rollover category shows what is available and what came in.
    expect(within(lunch).getByText("1,500.00", { selector: ".amount.rounded-full" })).toBeInTheDocument();
    expect(within(lunch).getByText("含上月 300.00")).toBeInTheDocument();
    // No budget: no remaining.
    expect(within(row("早餐")).getAllByText("—")).toHaveLength(6);
  });

  it("links the spent figure to the month's transactions of the category", () => {
    width(1440);
    renderGrid();
    expect(screen.getByRole("link", { name: "查看「午餐」2026年9月的流水" })).toHaveAttribute(
      "href",
      "/transactions?month=2026-09&category=11",
    );
    expect(screen.getByRole("link", { name: "查看「餐饮」2026年8月的流水" })).toHaveAttribute(
      "href",
      "/transactions?month=2026-08&category=10",
    );
  });

  it("shows two months on a tablet", () => {
    width(800);
    renderGrid();
    expect(screen.getAllByRole("columnheader", { name: /^2026年\d+月/ })).toHaveLength(2);
    expect(screen.queryByRole("columnheader", { name: "2026年8月" })).not.toBeInTheDocument();
  });

  it("shows the selected month only on a phone", () => {
    width(375);
    renderGrid();
    expect(screen.getAllByRole("columnheader", { name: /^2026年\d+月/ }).map((cell) => cell.textContent)).toEqual([
      "2026年10月本月",
    ]);
  });

  it("folds a level-1 category's rows", async () => {
    const user = userEvent.setup();
    width(375);
    renderGrid();
    await user.click(screen.getByRole("button", { name: "收起「餐饮」的二级分类" }));
    expect(screen.queryByRole("rowheader", { name: /午餐/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开「餐饮」的二级分类" }));
    expect(screen.getByRole("rowheader", { name: /午餐/ })).toBeInTheDocument();
  });

  it("saves a calculation from that month on, and clears with an empty input", async () => {
    const user = userEvent.setup();
    width(1440);
    const onSave = renderGrid();
    await user.click(screen.getByRole("button", { name: "修改「午餐」2026年8月的预算" }));
    const input = screen.getByRole("textbox", { name: "修改「午餐」2026年8月的预算" });
    expect(input).toHaveValue("1500");
    expect(screen.getByText(/^从2026年8月起生效，之后未单独设置的月份也会沿用/)).toBeInTheDocument();
    await user.clear(input);
    await user.type(input, "1500+300{Enter}");
    expect(onSave).toHaveBeenCalledWith(11, "2026-08", "1800.00");

    await user.click(screen.getByRole("button", { name: "修改「早餐」2026年10月的预算" }));
    await user.type(screen.getByRole("textbox", { name: "修改「早餐」2026年10月的预算" }), "200");
    await user.tab();
    expect(onSave).toHaveBeenLastCalledWith(12, "2026-10", "200.00");

    await user.click(screen.getByRole("button", { name: "修改「午餐」2026年9月的预算" }));
    await user.clear(screen.getByRole("textbox", { name: "修改「午餐」2026年9月的预算" }));
    await user.keyboard("{Enter}");
    expect(onSave).toHaveBeenLastCalledWith(11, "2026-09", null);
    expect(onSave).toHaveBeenCalledTimes(3);
  });

  it("does not save on Esc, an unchanged amount or an invalid one", async () => {
    const user = userEvent.setup();
    width(1440);
    const onSave = renderGrid();
    await user.click(screen.getByRole("button", { name: "修改「午餐」2026年8月的预算" }));
    await user.type(screen.getByRole("textbox", { name: "修改「午餐」2026年8月的预算" }), "9{Escape}");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "修改「午餐」2026年8月的预算" }));
    await user.keyboard("{Enter}");

    await user.click(screen.getByRole("button", { name: "修改「午餐」2026年8月的预算" }));
    await user.keyboard("1+{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent("请输入不小于 0 的金额或算式");
    expect(screen.getByRole("textbox")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows the reason and the amount as it was when saving fails", async () => {
    const user = userEvent.setup();
    width(1440);
    renderGrid(
      vi.fn(async () => {
        throw new ApiError(422, "VALIDATION_ERROR", "金额无效");
      }),
    );
    await user.click(screen.getByRole("button", { name: "修改「午餐」2026年8月的预算" }));
    await user.keyboard("2000{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("保存失败：金额无效");
    expect(within(screen.getByRole("button", { name: "修改「午餐」2026年8月的预算" })).getByText("1,500.00")).toBeInTheDocument();
  });
});
