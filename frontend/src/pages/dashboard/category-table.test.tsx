import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { CategoryTable } from "./category-table";

const detail: Schemas["MonthDetailOut"] = {
  budget_account_id: null,
  currency: "CNY",
  month: "2026-10",
  budget: "1500.00",
  actual: "3599.80",
  count: 17,
  annual_actual: "0.00",
  categories: [
    {
      category_id: 1,
      name: "餐饮",
      budget: "500.00",
      actual: "300.00",
      count: 12,
      children: [
        { category_id: 11, name: "买菜", budget: "500.00", actual: "300.00", count: 12 },
        { category_id: 12, name: "礼物人情", budget: null, actual: "0.00", count: 0 },
      ],
    },
    {
      category_id: 2,
      name: "娱乐休闲",
      budget: "1000.00",
      actual: "3200.00",
      count: 3,
      children: [{ category_id: 21, name: "旅行", budget: "1000.00", actual: "3200.00", count: 3 }],
    },
    {
      category_id: 3,
      name: "宠物",
      budget: null,
      actual: "99.80",
      count: 2,
      children: [{ category_id: 31, name: "猫粮用品", budget: null, actual: "99.80", count: 2 }],
    },
  ],
};

const rowOf = (name: string) => screen.getByRole("rowheader", { name: new RegExp(name) }).closest("tr")!;

describe("CategoryTable", () => {
  it("shows level-1 rows with budget, actual and remaining, and a total", () => {
    render(<CategoryTable detail={detail} />);
    const food = within(rowOf("餐饮"));
    expect(food.getByText("¥500.00")).toBeInTheDocument();
    expect(food.getByText("¥300.00")).toBeInTheDocument();
    expect(food.getByText("¥200.00")).toBeInTheDocument();
    expect(within(rowOf("合计")).getByText("¥3,599.80")).toBeInTheDocument();
    expect(screen.queryByText("买菜")).not.toBeInTheDocument();
  });

  it("marks an over-budget row and states the overspend", () => {
    render(<CategoryTable detail={detail} />);
    const leisure = within(rowOf("娱乐休闲"));
    expect(leisure.getByText("超支")).toBeInTheDocument();
    expect(leisure.getAllByText("超支 ¥2,200.00").length).toBeGreaterThan(0);
    expect(leisure.getAllByText("320%").length).toBeGreaterThan(0);
    expect(within(rowOf("餐饮")).queryByText("超支")).not.toBeInTheDocument();
  });

  it("shows 未设预算 with the actual only for an unbudgeted category", () => {
    render(<CategoryTable detail={detail} />);
    const pets = within(rowOf("宠物"));
    expect(pets.getAllByText("未设预算").length).toBeGreaterThan(0);
    expect(pets.getByText("¥99.80")).toBeInTheDocument();
    expect(pets.queryByRole("meter")).not.toBeInTheDocument();
  });

  it("expands a level-1 row to its level-2 rows and collapses it again", async () => {
    const user = userEvent.setup();
    render(<CategoryTable detail={detail} />);
    const toggle = screen.getByRole("button", { name: "展开「餐饮」的二级分类" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(screen.getByText("买菜")).toBeInTheDocument();
    expect(within(rowOf("礼物人情")).getAllByText("未设预算").length).toBeGreaterThan(0);
    expect(screen.queryByText("旅行")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起「餐饮」的二级分类" }));
    expect(screen.queryByText("买菜")).not.toBeInTheDocument();
  });

  it("shows the consumption count per row and for the total, folded under the amount when narrow", async () => {
    const user = userEvent.setup();
    render(<CategoryTable detail={detail} />);
    expect(screen.getByRole("columnheader", { name: "笔数" })).toBeInTheDocument();
    const food = within(rowOf("餐饮"));
    // The count column (md and up) and the line under the amount (below md).
    expect(food.getByRole("cell", { name: "12" })).toBeInTheDocument();
    expect(food.getByText("12 笔")).toHaveClass("md:hidden");
    expect(within(rowOf("合计")).getByRole("cell", { name: "17" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "展开「餐饮」的二级分类" }));
    expect(within(rowOf("礼物人情")).getByText("0 笔")).toBeInTheDocument();
  });

  it("expands and collapses everything", async () => {
    const user = userEvent.setup();
    render(<CategoryTable detail={detail} />);
    await user.click(screen.getByRole("button", { name: "全部展开" }));
    for (const name of ["买菜", "旅行", "猫粮用品"]) expect(screen.getByText(name)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "全部收起" }));
    expect(screen.queryByText("旅行")).not.toBeInTheDocument();
  });
});
