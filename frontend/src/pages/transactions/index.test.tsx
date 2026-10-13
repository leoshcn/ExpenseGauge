import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";
import type { TransactionFilter } from "@/api/queries";

const daily = { id: 1, name: "日常", period: "month" as const };

const tree: Schemas["CategoryTree"] = {
  budget_account_id: null,
  categories: [
    {
      id: 1,
      name: "餐饮",
      children: [
        { id: 11, name: "买菜", description: null, budget_account: daily },
        { id: 12, name: "外食", description: null, budget_account: daily },
      ],
    },
  ],
};

const transaction: Schemas["TransactionOut"] = {
  id: 100,
  date: "2026-10-03",
  amount: "35.50",
  counterparty: "盒马鲜生",
  description: "",
  note: null,
  category_id: 11,
  category_name: "买菜",
  parent_category_id: 1,
  parent_category_name: "餐饮",
  channel_id: 5,
  channel_name: "招商储蓄卡",
  budget_account_id: daily.id,
  budget_account_name: daily.name,
  confirmed_duplicate: false,
  refund_of: null,
  refunded: "0.00",
  created_at: "2026-10-03T10:00:00Z",
};

/** A payment of 100 with 30 refunded, and the refund matched to it. */
const payment: Schemas["TransactionOut"] = {
  ...transaction,
  id: 7,
  date: "2026-09-01",
  amount: "100.00",
  counterparty: "京东",
  refunded: "30.00",
};
const otherPayment: Schemas["TransactionOut"] = {
  ...transaction,
  id: 8,
  date: "2026-08-20",
  amount: "60.00",
  counterparty: "淘宝",
  category_id: 12,
  category_name: "外食",
};
const target = (of: Schemas["TransactionOut"]): Schemas["RefundTarget"] => ({
  id: of.id,
  date: of.date,
  amount: of.amount,
  counterparty: of.counterparty,
  category_name: of.category_name,
});
const matchedRefund: Schemas["TransactionOut"] = {
  ...transaction,
  id: 200,
  date: "2026-10-05",
  amount: "-30.00",
  counterparty: "京东退款",
  refund_of: target(payment),
};
const unmatchedRefund: Schemas["TransactionOut"] = {
  ...transaction,
  id: 201,
  date: "2026-10-06",
  amount: "-12.00",
  counterparty: "淘宝退款",
  category_id: 12,
  category_name: "外食",
};
const fullyRefunded: Schemas["TransactionOut"] = { ...payment, id: 9, counterparty: "全退", refunded: "100.00" };

const stats: Schemas["TransactionStats"] = { count: 3, net_amount: "1234.00" };
const requested: TransactionFilter[] = [];
const candidateSearches: string[] = [];
let rows: Schemas["TransactionOut"][] = [];

const updateTransaction = vi.fn(async (id: number, body: Schemas["TransactionUpdateIn"]) => ({
  ...rows.find((row) => row.id === id)!,
  ...body,
}));
const deleteTransaction = vi.fn<(id: number) => Promise<undefined>>(async () => undefined);

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    settingsQuery: queryOptions({ queryKey: actual.keys.settings, queryFn: async () => ({ currency: "CNY" }) }),
    budgetAccountsQuery: queryOptions({ queryKey: actual.keys.budgetAccounts, queryFn: async () => [daily] }),
    channelsQuery: queryOptions({
      queryKey: actual.keys.channels,
      queryFn: async (): Promise<Schemas["ChannelOut"][]> => [{ id: 5, name: "招商储蓄卡" }],
    }),
    categoriesQuery: () => queryOptions({ queryKey: actual.keys.categories(null), queryFn: async () => tree }),
    transactionPageQuery: (filter: TransactionFilter) =>
      queryOptions({
        queryKey: actual.keys.transactionPage(filter),
        queryFn: async (): Promise<Schemas["TransactionPage"]> => {
          requested.push(filter);
          return { items: rows, page: filter.page, page_size: filter.pageSize, total: rows.length, stats };
        },
      }),
    refundCandidatesQuery: (transactionId: number, q: string, page = 1) =>
      queryOptions({
        queryKey: actual.keys.refundCandidates(transactionId, q, page),
        queryFn: async (): Promise<Schemas["RefundCandidatePage"]> => {
          candidateSearches.push(q);
          const items = [payment, otherPayment].filter((p) => p.counterparty.includes(q));
          return { items, total: items.length, page, page_size: 20 };
        },
      }),
    refundsQuery: (transactionId: number) =>
      queryOptions({
        queryKey: actual.keys.refunds(transactionId),
        queryFn: async (): Promise<Schemas["TransactionOut"][]> =>
          transactionId === payment.id ? [matchedRefund] : [],
      }),
    updateTransaction,
    deleteTransaction,
  };
});

const { TransactionsPage } = await import("./index");

function renderAt(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <TransactionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const rowOf = (counterparty: string) =>
  screen.getByRole("rowheader", { name: new RegExp(counterparty) }).closest("tr")!;

async function openEdit(counterparty: string) {
  const user = userEvent.setup();
  renderAt("/transactions");
  await user.click(await screen.findByRole("button", { name: `编辑「${counterparty}」` }));
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("TransactionsPage", () => {
  beforeAll(() => {
    // Only the clock: dates of the current year are shown without the year.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 11, 12));
  });
  afterAll(() => vi.useRealTimers());

  beforeEach(() => {
    requested.length = 0;
    candidateSearches.length = 0;
    rows = [];
    updateTransaction.mockClear();
    deleteTransaction.mockReset();
    deleteTransaction.mockImplementation(async () => undefined);
  });

  it("drops ids from the URL that do not exist before asking the API", async () => {
    renderAt("/transactions?category=999&channel=998&budget_account=997");
    expect(await screen.findByText("还没有流水")).toBeInTheDocument();
    expect(requested.map(({ categoryId, channelId, budgetAccountId }) => [categoryId, channelId, budgetAccountId])).toEqual([
      [null, null, null],
    ]);
  });

  it("passes known filters to the API and shows each row's channel", async () => {
    rows = [transaction];
    renderAt("/transactions?channel=5&budget_account=1&category=1");
    expect(await screen.findAllByText("招商储蓄卡")).not.toHaveLength(0);
    expect(screen.getByRole("columnheader", { name: "渠道" })).toBeInTheDocument();
    expect(requested).toEqual([
      expect.objectContaining({ channelId: 5, budgetAccountId: 1, categoryId: 1, month: null, refundStatus: null, page: 1 }),
    ]);
  });

  it("shows the filter's consumption count and net amount", async () => {
    rows = [transaction];
    renderAt("/transactions?month=2026-10");
    expect(await screen.findByLabelText("筛选结果统计")).toHaveTextContent("消费 3 笔 · 净支出 ¥1,234.00（含年度开支）");
  });

  it("narrows the list to unmatched refunds and back", async () => {
    const user = userEvent.setup();
    rows = [unmatchedRefund];
    renderAt("/transactions");
    const toggle = await screen.findByRole("button", { name: "仅看未匹配退款" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle);
    await waitFor(() => expect(requested.at(-1)).toMatchObject({ refundStatus: "unmatched", page: 1 }));
    expect(screen.getByRole("button", { name: "仅看未匹配退款" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "清除筛选" }));
    await waitFor(() => expect(requested.at(-1)).toMatchObject({ refundStatus: null }));
  });

  it("labels refunds as matched or unmatched and payments as partly or fully refunded", async () => {
    rows = [matchedRefund, unmatchedRefund, payment, fullyRefunded, transaction];
    renderAt("/transactions");
    await screen.findByText("京东退款");
    const matchedRow = within(rowOf("京东退款"));
    expect(matchedRow.getByText("已匹配")).toBeInTheDocument();
    expect(matchedRow.getByText("原支付：9月1日「京东」")).toBeInTheDocument();
    expect(within(rowOf("淘宝退款")).getByText("未匹配")).toBeInTheDocument();
    expect(within(rowOf("^京东(?!退款)")).getByText("已退 ¥30.00")).toBeInTheDocument();
    expect(within(rowOf("全退")).getByText("已全额退款")).toBeInTheDocument();
    const plain = within(rowOf("盒马鲜生"));
    expect(plain.queryByText(/已退|已全额退款|未匹配|已匹配/)).not.toBeInTheDocument();
  });

  it("matches an unmatched refund to a searched payment; its category then follows the payment", async () => {
    rows = [unmatchedRefund];
    const { user, dialog } = await openEdit("淘宝退款");
    expect(within(dialog).getByRole("combobox", { name: "分类" })).toBeEnabled();
    expect(within(dialog).getByText("未匹配：按退款自己的月份和分类统计。")).toBeInTheDocument();
    // A pending change makes the form submittable, so Enter in the search would save it.
    await user.type(within(dialog).getByRole("textbox", { name: "备注" }), "补记");

    await user.click(within(dialog).getByRole("button", { name: "选择原支付" }));
    const search = within(dialog).getByRole("searchbox", { name: "搜索原支付" });
    await user.type(search, "京东{Enter}");
    await waitFor(() => expect(candidateSearches).toContain("京东"));
    await waitFor(() =>
      expect(within(dialog).queryByRole("button", { name: /选择 .*「淘宝」/ })).not.toBeInTheDocument(),
    );
    expect(updateTransaction).not.toHaveBeenCalled(); // Enter in the search does not save
    await user.click(within(dialog).getByRole("button", { name: "选择 9月1日「京东」" }));

    expect(within(dialog).getByText("9月1日「京东」¥100.00")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "分类" })).toBeDisabled();
    expect(within(dialog).getByText("已匹配原支付，分类跟随原支付；取消匹配后可单独修改。")).toBeInTheDocument();
    const before = requested.length;
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(updateTransaction).toHaveBeenCalledWith(unmatchedRefund.id, { refund_of_id: payment.id, note: "补记" }),
    );
    expect(updateTransaction).toHaveBeenCalledTimes(1);
    // The list is fetched again, so the row and the stats follow the match.
    await waitFor(() => expect(requested.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("changes a refund's payment, or removes the match", async () => {
    rows = [matchedRefund];
    const first = await openEdit("京东退款");
    expect(within(first.dialog).getByRole("combobox", { name: "分类" })).toBeDisabled();
    await first.user.click(within(first.dialog).getByRole("button", { name: "更换" }));
    await first.user.click(await within(first.dialog).findByRole("button", { name: "选择 8月20日「淘宝」" }));
    await first.user.click(within(first.dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateTransaction).toHaveBeenLastCalledWith(matchedRefund.id, { refund_of_id: otherPayment.id }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await first.user.click(screen.getByRole("button", { name: "编辑「京东退款」" }));
    const dialog = await screen.findByRole("dialog");
    await first.user.click(within(dialog).getByRole("button", { name: "取消匹配" }));
    expect(within(dialog).getByRole("button", { name: "选择原支付" })).toBeInTheDocument();
    // Its own category comes back from the server; it is edited after saving.
    expect(within(dialog).getByRole("combobox", { name: "分类" })).toBeDisabled();
    await first.user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateTransaction).toHaveBeenLastCalledWith(matchedRefund.id, { refund_of_id: null }));
  });

  it("lists a payment's matched refunds and what is left", async () => {
    rows = [payment];
    const { dialog } = await openEdit("京东");
    const refunds = within(dialog).getByRole("region", { name: "已匹配的退款" });
    expect(within(refunds).getByText("已退 ¥30.00 · 净额 ¥70.00")).toBeInTheDocument();
    expect(await within(refunds).findByText("京东退款")).toBeInTheDocument();
    expect(within(refunds).getByText("-¥30.00")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "选择原支付" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "分类" })).toBeEnabled();
  });

  it("shows why deleting a payment with matched refunds is refused", async () => {
    const user = userEvent.setup();
    rows = [payment];
    deleteTransaction.mockRejectedValue(
      new ApiError(409, "TRANSACTION_HAS_REFUNDS", "这笔支付已匹配 1 笔退款，请先取消匹配或删除对应退款", {
        refund_ids: [matchedRefund.id],
      }),
    );
    renderAt("/transactions");
    await user.click(await screen.findByRole("button", { name: "删除「京东」" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "删除" }));
    expect(await within(confirm).findByText("这笔支付已匹配 1 笔退款，请先取消匹配或删除对应退款")).toBeInTheDocument();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });
});
