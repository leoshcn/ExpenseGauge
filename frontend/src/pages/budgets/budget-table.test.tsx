import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { BudgetTable } from "./budget-table";
import { type BudgetDraft, budgetChanges, groupLines } from "./model";

const tree: Schemas["CategoryTree"] = {
  account_id: 1,
  categories: [
    { id: 1, name: "餐饮", children: [{ id: 11, name: "买菜" }, { id: 12, name: "外卖" }] },
    { id: 2, name: "宠物", children: [{ id: 21, name: "猫粮用品" }] },
    { id: 3, name: "空的", children: [] },
  ],
};

const lines: Schemas["BudgetLine"][] = [
  { category_id: 11, category_name: "买菜", parent_id: 1, parent_name: "餐饮", amount: "500.00", effective_from: "2026-07" },
  { category_id: 12, category_name: "外卖", parent_id: 1, parent_name: "餐饮", amount: "0.00", effective_from: "2026-09" },
  { category_id: 21, category_name: "猫粮用品", parent_id: 2, parent_name: "宠物", amount: null, effective_from: null },
];

/** The table with its draft state, reporting the PUT items it would send. */
function Harness({ onItems }: { onItems: (items: ReturnType<typeof budgetChanges>) => void }) {
  const [draft, setDraft] = useState<BudgetDraft>({});
  onItems(budgetChanges(lines, draft));
  return (
    <BudgetTable
      groups={groupLines(tree, lines)}
      draft={draft}
      currency="CNY"
      onChange={(id, text) => setDraft({ ...draft, [id]: text })}
    />
  );
}

const input = (name: string) => screen.getByRole("textbox", { name: `「${name}」的预算金额` });
const groupRow = (name: string) => screen.getAllByRole("rowheader", { name })[0]!.closest("tr")!;

describe("BudgetTable", () => {
  it("tells a zero budget apart from no budget", () => {
    render(<Harness onItems={() => {}} />);
    expect(input("外卖")).toHaveValue("0.00");
    expect(input("猫粮用品")).toHaveValue("");
    expect(input("猫粮用品")).toHaveAttribute("placeholder", "未设预算");
    // The level-1 subtotal counts the zero; a group with no budget at all says so.
    expect(within(groupRow("餐饮")).getByText("¥500.00")).toBeInTheDocument();
    expect(within(groupRow("宠物")).getByText("未设预算")).toBeInTheDocument();
    expect(screen.getByText("尚无二级分类，请先在「设置 → 分类」中添加")).toBeInTheDocument();
  });

  it("clears a budget to null, sets zero as a value, and updates the subtotal", async () => {
    const user = userEvent.setup();
    let latest: ReturnType<typeof budgetChanges> = { items: [], invalid: [] };
    render(<Harness onItems={(items) => (latest = items)} />);

    await user.click(screen.getByRole("button", { name: "清空「买菜」的预算" }));
    await user.type(input("猫粮用品"), "0");
    expect(latest).toEqual({
      items: [
        { category_id: 11, amount: null },
        { category_id: 21, amount: "0.00" },
      ],
      invalid: [],
    });
    expect(screen.getByText("原为 ¥500.00")).toBeInTheDocument();
    expect(screen.getByText("原为 未设预算")).toBeInTheDocument();
    expect(within(groupRow("餐饮")).getByText("¥0.00")).toBeInTheDocument();
  });

  it("flags an invalid amount and leaves it out of the request", async () => {
    const user = userEvent.setup();
    let latest: ReturnType<typeof budgetChanges> = { items: [], invalid: [] };
    render(<Harness onItems={(items) => (latest = items)} />);
    await user.clear(input("买菜"));
    await user.type(input("买菜"), "-5");
    expect(input("买菜")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("请输入不小于 0 的金额，最多两位小数")).toBeInTheDocument();
    expect(latest).toEqual({ items: [], invalid: [11] });
  });
});
