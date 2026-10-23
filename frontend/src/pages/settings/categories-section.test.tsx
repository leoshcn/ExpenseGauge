import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

import { reorderTree } from "./model";

const daily: Schemas["BudgetAccountOut"] = { id: 1, name: "日常", period: "month" };
const fixed: Schemas["BudgetAccountOut"] = { id: 2, name: "固定", period: "month" };
const yearly: Schemas["BudgetAccountOut"] = { id: 3, name: "年度", period: "year" };

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [
    {
      id: 10,
      name: "餐饮",
      children: [
        { id: 11, name: "超市", description: "线下商超、便利店\n不含外卖", budget_account: daily, rollover_from: null },
        { id: 12, name: "外食", description: null, budget_account: daily, rollover_from: null },
      ],
    },
    {
      id: 20,
      name: "居住",
      children: [{ id: 21, name: "房租", description: null, budget_account: fixed, rollover_from: null }],
    },
  ],
};

/**
 * What the backend holds; `GET /categories` and a successful reorder read and write it.
 * While `offline`, `GET /categories` fails.
 */
const server = { tree, offline: false };

const categoryOut = (id: number, body: { name?: string; description?: string | null; parent_id?: number | null; budget_account_id?: number | null }): Schemas["CategoryOut"] => ({
  id,
  parent_id: body.parent_id ?? 10,
  name: body.name ?? "",
  description: body.description ?? null,
  budget_account_id: body.budget_account_id ?? 1,
  rollover_from: null,
});

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    categoriesQuery: () => ({
      queryKey: actual.keys.categories(null),
      queryFn: async () => {
        if (server.offline) throw new Error("offline");
        return server.tree;
      },
    }),
    reorderCategories: vi.fn(),
    updateCategory: vi.fn(async (id: number, body: Schemas["CategoryUpdateIn"]) => categoryOut(id, body)),
    createCategory: vi.fn(async (body: Schemas["CategoryCreateIn"]) => categoryOut(99, body)),
  };
});

const queries = await import("@/api/queries");
const { CategoriesSection } = await import("./categories-section");

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <CategoriesSection budgetAccounts={[daily, fixed, yearly]} />
    </QueryClientProvider>,
  );
}

describe("CategoriesSection", () => {
  beforeEach(() => {
    vi.mocked(queries.updateCategory).mockClear();
    vi.mocked(queries.createCategory).mockClear();
    server.tree = tree;
  });

  it("shows a level-2 description and budget account; level 1 keeps the rename dialog", async () => {
    const user = userEvent.setup();
    renderSection();
    const row = (await screen.findByText("超市")).closest("li")!;
    expect(within(row).getByText(/线下商超、便利店/)).toHaveClass("line-clamp-2");
    expect(within(row).getByText("日常")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "编辑「超市」" })).toBeInTheDocument();
    expect(within(screen.getByText("房租").closest("li")!).getByText("固定")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "重命名「餐饮」" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("说明（选填）")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("combobox", { name: "预算账户" })).not.toBeInTheDocument();
  });

  it("edits only the description, with a counter, and sends only that field", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "编辑「外食」" }));
    const dialog = await screen.findByRole("dialog");
    const description = within(dialog).getByLabelText("说明（选填）");
    expect(description).toHaveAttribute("maxLength", "500");
    expect(within(dialog).getByText("0/500")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "预算账户" })).toHaveTextContent("日常");

    await user.type(description, "餐馆堂食");
    expect(within(dialog).getByText("4/500")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(queries.updateCategory).toHaveBeenCalledExactlyOnceWith(12, { description: "餐馆堂食" });
  });

  it("clears a description with null and closes without a request when nothing changed", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "编辑「超市」" }));
    let dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(queries.updateCategory).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "编辑「超市」" }));
    dialog = await screen.findByRole("dialog");
    await user.clear(within(dialog).getByLabelText("说明（选填）"));
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(queries.updateCategory).toHaveBeenCalledExactlyOnceWith(11, { description: null }));
  });

  /** Radix Select keeps a hidden native select in a form; changing it is what autofill does. */
  const chooseBudgetAccount = (dialog: HTMLElement, id: number) =>
    fireEvent.change(dialog.querySelector("select")!, { target: { value: String(id) } });

  it("moves within the same period without asking for a budget", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "编辑「外食」" }));
    const dialog = await screen.findByRole("dialog");
    chooseBudgetAccount(dialog, 2);
    expect(within(dialog).getByRole("combobox", { name: "预算账户" })).toHaveTextContent("固定");
    expect(within(dialog).queryByLabelText("新的年度预算")).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(queries.updateCategory).toHaveBeenCalledExactlyOnceWith(12, { budget_account_id: 2 }));
  });

  it("asks for the new budget when moving to the other period, and sends it", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "编辑「外食」" }));
    const dialog = await screen.findByRole("dialog");
    chooseBudgetAccount(dialog, 3);
    expect(within(dialog).getByText(/原有的全部预算会被清除/)).toBeInTheDocument();
    const amount = within(dialog).getByLabelText("新的年度预算");

    // Neither an amount nor "无预算": refused before any request.
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    expect(within(dialog).getByText("请输入新的预算，或选择「无预算」")).toBeInTheDocument();
    expect(queries.updateCategory).not.toHaveBeenCalled();

    await user.type(amount, "6000");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(queries.updateCategory).toHaveBeenCalledExactlyOnceWith(12, {
        budget_account_id: 3,
        budget_amount: "6000.00",
      }),
    );
  });

  it("sends budget_amount null when 无预算 is chosen", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "编辑「外食」" }));
    const dialog = await screen.findByRole("dialog");
    chooseBudgetAccount(dialog, 3);
    await user.click(within(dialog).getByRole("checkbox", { name: "无预算（只统计实际支出）" }));
    expect(within(dialog).getByLabelText("新的年度预算")).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(queries.updateCategory).toHaveBeenCalledExactlyOnceWith(12, { budget_account_id: 3, budget_amount: null }),
    );
  });

  it("adds a level-2 category with its description, in the first budget account by default", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "在「餐饮」下添加二级分类" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "预算账户" })).toHaveTextContent("日常");
    await user.type(within(dialog).getByLabelText("分类名称"), "零食");
    await user.type(within(dialog).getByLabelText("说明（选填）"), "  饼干、糖果  ");
    await user.click(within(dialog).getByRole("button", { name: "添加" }));
    await waitFor(() =>
      expect(queries.createCategory).toHaveBeenCalledExactlyOnceWith({
        name: "零食",
        description: "饼干、糖果",
        parent_id: 10,
        budget_account_id: 1,
      }),
    );
  });
});

describe("CategoriesSection: reordering", () => {
  const handle = (name: string) => screen.getByRole("button", { name: `拖动调整「${name}」的顺序` });
  /** Category names as shown, top to bottom: level 1 with its level 2 right after it. */
  const shown = () =>
    screen.getAllByRole("listitem").map((item) => item.querySelector("span, p")!.firstChild!.textContent);
  /** Picks the row up with the keyboard, moves it one step and drops it (or `end`). */
  async function dragByKeyboard(name: string, arrow: "ArrowUp" | "ArrowDown", end = "Space") {
    const user = userEvent.setup();
    handle(name).focus();
    await user.keyboard("[Space]");
    await user.keyboard(`[${arrow}]`);
    await user.keyboard(`[${end}]`);
  }

  beforeEach(() => {
    server.tree = tree;
    server.offline = false;
    vi.mocked(queries.reorderCategories)
      .mockReset()
      .mockImplementation(async (body) => {
        server.tree = reorderTree(server.tree, body.parent_id, body.ordered_ids);
        return server.tree;
      });
    // jsdom has no layout. Rows of 40px stacked in document order (a level-1 row spans its
    // children) let dnd-kit tell which row is below which.
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const rows = [...document.querySelectorAll("li")];
      const inside = this.querySelectorAll("li").length;
      const self = this.tagName === "LI";
      const first = rows.indexOf((self ? this : this.querySelector("li")) as HTMLLIElement);
      if (first < 0) return new DOMRect(0, 0, 0, 0);
      return new DOMRect(0, first * 40, 300, (inside + (self ? 1 : 0)) * 40);
    });
  });

  afterEach(() => {
    vi.mocked(Element.prototype.getBoundingClientRect).mockRestore();
  });

  it("gives every row a named handle, disabled where there is nothing to reorder", async () => {
    renderSection();
    await screen.findByText("超市");
    for (const name of ["餐饮", "居住", "超市", "外食"]) {
      expect(handle(name)).toBeEnabled();
      expect(handle(name)).toHaveAttribute("aria-disabled", "false");
      expect(handle(name)).toHaveAttribute("aria-roledescription", "可排序项");
      expect(handle(name)).toHaveAccessibleDescription(/按空格键拾起，用上下方向键移动/);
    }
    expect(handle("房租")).toBeDisabled(); // the only level 2 of 居住
    // The handle comes first in its row, before the name and the row's own actions.
    const row = screen.getByText("超市").closest("li")!;
    expect(within(row).getAllByRole("button")[0]).toBe(handle("超市"));
    expect(within(row).getByRole("button", { name: "编辑「超市」" })).toBeEnabled();
  });

  it("moves a level-1 category with its children by keyboard and saves the new order", async () => {
    renderSection();
    await screen.findByText("超市");
    expect(shown()).toEqual(["餐饮", "超市", "外食", "居住", "房租"]);

    await dragByKeyboard("餐饮", "ArrowDown");

    await waitFor(() =>
      expect(queries.reorderCategories).toHaveBeenCalledExactlyOnceWith({ parent_id: null, ordered_ids: [20, 10] }),
    );
    await waitFor(() => expect(shown()).toEqual(["居住", "房租", "餐饮", "超市", "外食"]));
    expect(screen.getByText("已放下「餐饮」，现在在第 2 位，共 2 项。")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("moves a level-2 category inside its parent only", async () => {
    renderSection();
    await screen.findByText("超市");

    await dragByKeyboard("外食", "ArrowUp");

    await waitFor(() =>
      expect(queries.reorderCategories).toHaveBeenCalledExactlyOnceWith({ parent_id: 10, ordered_ids: [12, 11] }),
    );
    await waitFor(() => expect(shown()).toEqual(["餐饮", "外食", "超市", "居住", "房租"]));
  });

  it("sends nothing when the row is dropped where it was, or the drag is cancelled", async () => {
    renderSection();
    await screen.findByText("超市");

    await dragByKeyboard("超市", "ArrowUp"); // already the first of its parent: stays inside 餐饮
    await dragByKeyboard("外食", "ArrowDown"); // already the last: 居住's rows are out of reach
    await dragByKeyboard("居住", "ArrowUp", "Escape");
    expect(screen.getByText("已取消，「居住」回到原来的位置。")).toBeInTheDocument();

    expect(queries.reorderCategories).not.toHaveBeenCalled();
    expect(shown()).toEqual(["餐饮", "超市", "外食", "居住", "房租"]);
  });

  it("shows the new order while saving, then goes back and says why when the save fails", async () => {
    let fail!: (error: unknown) => void;
    vi.mocked(queries.reorderCategories).mockImplementation(
      () => new Promise((_resolve, reject) => (fail = reject)),
    );
    renderSection();
    await screen.findByText("超市");

    await dragByKeyboard("居住", "ArrowUp");

    // Optimistic: shown at once, and no second reorder can start meanwhile.
    await waitFor(() => expect(shown()).toEqual(["居住", "房租", "餐饮", "超市", "外食"]));
    expect(queries.reorderCategories).toHaveBeenCalledExactlyOnceWith({ parent_id: null, ordered_ids: [20, 10] });
    for (const name of ["餐饮", "居住", "超市", "外食"]) {
      expect(handle(name)).toHaveAttribute("aria-disabled", "true");
    }
    await dragByKeyboard("超市", "ArrowDown");
    expect(queries.reorderCategories).toHaveBeenCalledTimes(1);

    // The refetch after the failure fails too, so only the rollback can restore the order.
    server.offline = true;
    fail(new ApiError(422, "CATEGORY_ORDER_MISMATCH", "分类已发生变化，请刷新后重试"));

    expect(await screen.findByRole("alert")).toHaveTextContent("顺序没有保存：分类已发生变化，请刷新后重试");
    expect(shown()).toEqual(["餐饮", "超市", "外食", "居住", "房租"]);
    await waitFor(() => expect(handle("餐饮")).toHaveAttribute("aria-disabled", "false"));

    // The next successful reorder clears the message.
    server.offline = false;
    vi.mocked(queries.reorderCategories).mockImplementation(async () => server.tree);
    await dragByKeyboard("超市", "ArrowDown");
    await waitFor(() => expect(queries.reorderCategories).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  });
});
