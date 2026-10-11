import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { BudgetTable } from "./budget-table";
import { type BudgetDraft, budgetChanges, groupLines } from "./model";

const daily = { id: 1, name: "日常", period: "month" as const };
const fixed = { id: 2, name: "固定", period: "month" as const };

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [
    {
      id: 1,
      name: "餐饮",
      children: [
        { id: 11, name: "买菜", description: null, budget_account: daily },
        { id: 12, name: "外卖", description: null, budget_account: daily },
      ],
    },
    { id: 2, name: "宠物", children: [{ id: 21, name: "猫粮用品", description: null, budget_account: fixed }] },
    { id: 3, name: "空的", children: [] },
  ],
};

const of = (account: Schemas["BudgetAccountOut"]) => ({
  budget_account_id: account.id,
  budget_account_name: account.name,
  period: account.period,
});

const lines: Schemas["BudgetLine"][] = [
  { category_id: 11, category_name: "买菜", parent_id: 1, parent_name: "餐饮", ...of(daily), amount: "500.00", effective_from: "2026-07" },
  { category_id: 12, category_name: "外卖", parent_id: 1, parent_name: "餐饮", ...of(daily), amount: "0.00", effective_from: "2026-09" },
  { category_id: 21, category_name: "猫粮用品", parent_id: 2, parent_name: "宠物", ...of(fixed), amount: null, effective_from: null },
];

/** The table with its draft state, reporting the PUT items it would send. */
function Harness({
  onItems,
  showBudgetAccount,
  data = { tree, lines },
}: {
  onItems: (items: ReturnType<typeof budgetChanges>) => void;
  showBudgetAccount?: boolean;
  data?: { tree: Schemas["CategoryTree"]; lines: Schemas["BudgetLine"][] };
}) {
  const [draft, setDraft] = useState<BudgetDraft>({});
  onItems(budgetChanges(data.lines, draft));
  return (
    <BudgetTable
      groups={groupLines(data.tree, data.lines)}
      draft={draft}
      currency="CNY"
      year={2026}
      showBudgetAccount={showBudgetAccount}
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

  it("names each row's budget account only in the all-accounts view", () => {
    const { unmount } = render(<Harness onItems={() => {}} />);
    expect(screen.queryByText("固定")).not.toBeInTheDocument();
    unmount();

    render(<Harness onItems={() => {}} showBudgetAccount />);
    const row = screen.getAllByRole("rowheader", { name: /猫粮用品/ })[0]!;
    expect(within(row).getByText("固定")).toBeInTheDocument();
  });

  describe("with an annual budget account", () => {
    const yearly = { id: 3, name: "年度", period: "year" as const };
    const mixedTree: Schemas["CategoryTree"] = {
      budget_account_id: null,
      categories: [
        {
          id: 4,
          name: "娱乐",
          children: [
            { id: 41, name: "电影", description: null, budget_account: daily },
            { id: 42, name: "旅行", description: null, budget_account: yearly },
          ],
        },
      ],
    };
    const mixedLines: Schemas["BudgetLine"][] = [
      { category_id: 41, category_name: "电影", parent_id: 4, parent_name: "娱乐", ...of(daily), amount: "200.00", effective_from: "2026-07" },
      { category_id: 42, category_name: "旅行", parent_id: 4, parent_name: "娱乐", ...of(yearly), amount: "12000.00", effective_from: "2026-01" },
    ];
    const lineRow = (name: string) => screen.getAllByRole("rowheader", { name: new RegExp(name) })[0]!.closest("tr")!;

    it("labels each amount with its period and says which year an annual one applies to", () => {
      render(<Harness onItems={() => {}} data={{ tree: mixedTree, lines: mixedLines }} />);
      expect(within(lineRow("电影")).getAllByText("/月").length).toBeGreaterThan(0);
      expect(within(lineRow("电影")).queryByText("/年")).not.toBeInTheDocument();
      const travel = within(lineRow("旅行"));
      expect(travel.getAllByText("/年").length).toBeGreaterThan(0);
      expect(travel.getByText("年度预算，作用于 2026 全年")).toBeInTheDocument();
      expect(within(lineRow("电影")).queryByText(/作用于/)).not.toBeInTheDocument();
    });

    it("keeps monthly and annual amounts apart in subtotals and totals", async () => {
      const user = userEvent.setup();
      let latest: ReturnType<typeof budgetChanges> = { items: [], invalid: [] };
      render(<Harness onItems={(items) => (latest = items)} data={{ tree: mixedTree, lines: mixedLines }} />);
      const group = within(groupRow("娱乐"));
      expect(group.getByText("¥200.00")).toBeInTheDocument();
      expect(group.getByText("¥12,000.00")).toBeInTheDocument();
      expect(group.queryByText("¥12,200.00")).not.toBeInTheDocument();

      await user.clear(input("旅行"));
      await user.type(input("旅行"), "15000");
      expect(group.getByText("¥15,000.00")).toBeInTheDocument();
      // The request is the same as for a monthly line; the server dates it to January.
      expect(latest).toEqual({ items: [{ category_id: 42, amount: "15000.00" }], invalid: [] });
    });
  });
});
