import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

const daily: Schemas["BudgetAccountOut"] = { id: 1, name: "日常" };
const usableTree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [{ id: 10, name: "居住", children: [{ id: 11, name: "房租", description: null, budget_account: daily }] }],
};

const state: {
  settings: Schemas["SettingsOut"];
  budgetAccounts: Schemas["BudgetAccountOut"][];
  tree: Schemas["CategoryTree"];
  channels: Schemas["ChannelOut"][];
} = {
  settings: { currency: null },
  budgetAccounts: [],
  tree: { budget_account_id: null, categories: [] },
  channels: [],
};

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    settingsQuery: queryOptions({ queryKey: actual.keys.settings, queryFn: async () => state.settings }),
    budgetAccountsQuery: queryOptions({ queryKey: actual.keys.budgetAccounts, queryFn: async () => state.budgetAccounts }),
    categoriesQuery: () => queryOptions({ queryKey: actual.keys.categories(null), queryFn: async () => state.tree }),
    channelsQuery: queryOptions({ queryKey: actual.keys.channels, queryFn: async () => state.channels }),
    updateSettings: vi.fn(async (body: Schemas["SettingsUpdateIn"]) => ({ currency: body.currency })),
    createBudgetAccount: vi.fn(async (body: Schemas["BudgetAccountCreateIn"]) => ({ id: 1, name: body.name })),
    createCategory: vi.fn(
      async (body: Schemas["CategoryCreateIn"]): Promise<Schemas["CategoryOut"]> => ({
        id: body.parent_id ? 11 : 10,
        name: body.name,
        parent_id: body.parent_id ?? null,
        description: null,
        budget_account_id: body.budget_account_id ?? null,
      }),
    ),
    createChannel: vi.fn(),
  };
});

const queries = await import("@/api/queries");
const { OnboardingPage } = await import("./onboarding");

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/onboarding"]}>
        <OnboardingPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.settings = { currency: null };
    state.budgetAccounts = [];
    state.tree = { budget_account_id: null, categories: [] };
    state.channels = [];
  });

  it("step 1 sets the base currency and creates the first budget account", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByText("基础币种与第一个预算账户")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "第 1 步，共 3 步" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("预算账户名称"), " 日常 ");
    await user.click(screen.getByRole("button", { name: "继续" }));
    await waitFor(() => expect(queries.createBudgetAccount).toHaveBeenCalledExactlyOnceWith({ name: "日常" }));
    expect(queries.updateSettings).toHaveBeenCalledExactlyOnceWith({ currency: "CNY" });
  });

  it("step 2 creates level-2 categories in the first budget account by default", async () => {
    state.settings = { currency: "CNY" };
    state.budgetAccounts = [daily, { id: 2, name: "固定" }];
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole("heading", { name: "添加分类" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "第 1 个二级分类的预算账户" })).toHaveTextContent("日常");
    expect(screen.getByRole("button", { name: "下一步" })).toBeDisabled();

    await user.type(screen.getByLabelText("一级分类"), "居住");
    await user.type(screen.getByLabelText("二级分类 1"), "房租");
    await user.click(screen.getByRole("button", { name: "添加分类" }));
    await waitFor(() => expect(queries.createCategory).toHaveBeenCalledTimes(2));
    expect(queries.createCategory).toHaveBeenNthCalledWith(1, { name: "居住" });
    expect(queries.createCategory).toHaveBeenNthCalledWith(2, { name: "房租", parent_id: 10, budget_account_id: 1 });
  });

  it("stays on the categories step after its first group, until the user moves on", async () => {
    state.settings = { currency: "CNY" };
    state.budgetAccounts = [daily];
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "添加分类" });

    state.tree = usableTree;
    await user.type(screen.getByLabelText("一级分类"), "居住");
    await user.type(screen.getByLabelText("二级分类 1"), "房租");
    await user.click(screen.getByRole("button", { name: "添加分类" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "下一步" })).toBeEnabled());
    expect(screen.getByRole("heading", { name: "添加分类" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("heading", { name: "添加第一个付款渠道" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "完成，进入概览" })).toBeDisabled();
  });

  it("resumes at the channel step when only the channel is missing", async () => {
    state.settings = { currency: "CNY" };
    state.budgetAccounts = [daily];
    state.tree = usableTree;
    renderPage();
    expect(await screen.findByRole("heading", { name: "添加第一个付款渠道" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "第 3 步，共 3 步" })).toBeInTheDocument();
  });
});
