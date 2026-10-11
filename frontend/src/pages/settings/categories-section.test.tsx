import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

const daily: Schemas["BudgetAccountOut"] = { id: 1, name: "日常" };
const fixed: Schemas["BudgetAccountOut"] = { id: 2, name: "固定" };

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [
    {
      id: 10,
      name: "餐饮",
      children: [
        { id: 11, name: "超市", description: "线下商超、便利店\n不含外卖", budget_account: daily },
        { id: 12, name: "外食", description: null, budget_account: daily },
      ],
    },
    {
      id: 20,
      name: "居住",
      children: [{ id: 21, name: "房租", description: null, budget_account: fixed }],
    },
  ],
};

const categoryOut = (id: number, body: { name?: string; description?: string | null; parent_id?: number | null; budget_account_id?: number | null }): Schemas["CategoryOut"] => ({
  id,
  parent_id: body.parent_id ?? 10,
  name: body.name ?? "",
  description: body.description ?? null,
  budget_account_id: body.budget_account_id ?? 1,
});

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    categoriesQuery: () => ({ queryKey: actual.keys.categories(null), queryFn: async () => tree }),
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
      <CategoriesSection budgetAccounts={[daily, fixed]} />
    </QueryClientProvider>,
  );
}

describe("CategoriesSection", () => {
  beforeEach(() => {
    vi.mocked(queries.updateCategory).mockClear();
    vi.mocked(queries.createCategory).mockClear();
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
