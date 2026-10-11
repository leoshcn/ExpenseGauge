import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import {
  awaitsLists,
  budgetAccountOf,
  type FilterLists,
  findCategory,
  isFiltered,
  isRefund,
  monthOptions,
  PAGE_SIZE,
  pageRange,
  readFilter,
  transactionChanges,
} from "./model";

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
        { id: 12, name: "外卖", description: null, budget_account: fixed },
      ],
    },
    { id: 2, name: "交通", children: [] },
  ],
};

const lists: FilterLists = { tree, channels: [{ id: 5, name: "储蓄卡" }], budgetAccounts: [daily, fixed] };
const loadingLists: FilterLists = { tree: undefined, channels: undefined, budgetAccounts: undefined };

describe("readFilter", () => {
  it("reads month, channel, budget account, category and page", () => {
    const params = new URLSearchParams("month=2026-09&channel=5&budget_account=2&category=12&page=3");
    expect(readFilter(params, lists)).toEqual({
      month: "2026-09",
      channelId: 5,
      budgetAccountId: 2,
      categoryId: 12,
      page: 3,
      pageSize: PAGE_SIZE,
    });
  });

  it("accepts a level-1 category", () => {
    expect(readFilter(new URLSearchParams("category=1"), lists).categoryId).toBe(1);
  });

  it("falls back on anything it cannot use", () => {
    const params = new URLSearchParams("month=2026-13&channel=6&budget_account=9&category=99&page=-1");
    expect(readFilter(params, lists)).toEqual({
      month: null,
      channelId: null,
      budgetAccountId: null,
      categoryId: null,
      page: 1,
      pageSize: PAGE_SIZE,
    });
    expect(readFilter(new URLSearchParams("category=abc&channel=1.5&page=1.5"), lists)).toMatchObject({
      channelId: null,
      categoryId: null,
      page: 1,
    });
  });

  it("keeps ids until their lists are known, and says it is waiting for them", () => {
    const params = new URLSearchParams("category=99&channel=7&budget_account=8");
    expect(readFilter(params, loadingLists)).toMatchObject({ categoryId: 99, channelId: 7, budgetAccountId: 8 });
    expect(awaitsLists(params, loadingLists)).toBe(true);
    expect(awaitsLists(params, lists)).toBe(false);
    expect(awaitsLists(new URLSearchParams("month=2026-09"), loadingLists)).toBe(false);
  });
});

describe("isFiltered", () => {
  it("is true for any filter but not for the page alone", () => {
    expect(isFiltered(readFilter(new URLSearchParams("page=2"), lists))).toBe(false);
    expect(isFiltered(readFilter(new URLSearchParams("channel=5"), lists))).toBe(true);
    expect(isFiltered(readFilter(new URLSearchParams("budget_account=1"), lists))).toBe(true);
  });
});

describe("budgetAccountOf", () => {
  it("is the level-2 category's budget account", () => {
    expect(budgetAccountOf(tree, 12)).toEqual(fixed);
    expect(budgetAccountOf(tree, 1)).toBeNull();
    expect(budgetAccountOf(tree, 99)).toBeNull();
  });
});

describe("monthOptions", () => {
  const now = new Date(2026, 9, 10);

  it("lists 24 months back from now, newest first, across the year boundary", () => {
    const months = monthOptions(now, null);
    expect(months).toHaveLength(24);
    expect(months[0]).toBe("2026-10");
    expect(months[9]).toBe("2026-01");
    expect(months[10]).toBe("2025-12");
    expect(months.at(-1)).toBe("2024-11");
  });

  it("keeps an older selected month at the end", () => {
    const months = monthOptions(now, "2020-05");
    expect(months.at(-1)).toBe("2020-05");
    expect(months).toHaveLength(25);
  });

  it("does not duplicate a selected month already listed", () => {
    expect(monthOptions(now, "2026-09")).toHaveLength(24);
  });
});

describe("findCategory", () => {
  it("finds level-1 and level-2 categories", () => {
    expect(findCategory(tree, 1)).toEqual({ parent: tree.categories[0], child: null });
    expect(findCategory(tree, 12)?.child?.name).toBe("外卖");
    expect(findCategory(tree, 99)).toBeNull();
  });
});

describe("pageRange", () => {
  it("gives the rows shown and the page count", () => {
    expect(pageRange(1, 50, 120)).toEqual({ from: 1, to: 50, pages: 3 });
    expect(pageRange(3, 50, 120)).toEqual({ from: 101, to: 120, pages: 3 });
    expect(pageRange(1, 50, 50)).toEqual({ from: 1, to: 50, pages: 1 });
  });

  it("handles an empty list", () => {
    expect(pageRange(1, 50, 0)).toEqual({ from: 0, to: 0, pages: 1 });
  });
});

describe("isRefund", () => {
  it("is true only for negative amounts", () => {
    expect(isRefund("-12.50")).toBe(true);
    expect(isRefund("12.50")).toBe(false);
    expect(isRefund("0.00")).toBe(false);
  });
});

describe("transactionChanges", () => {
  const original = { category_id: 11, note: "周末" };

  it("is null when nothing changed, including surrounding spaces", () => {
    expect(transactionChanges(original, { categoryId: 11, note: "周末" })).toBeNull();
    expect(transactionChanges(original, { categoryId: 11, note: "  周末 " })).toBeNull();
  });

  it("sends only the changed fields", () => {
    expect(transactionChanges(original, { categoryId: 12, note: "周末" })).toEqual({ category_id: 12 });
    expect(transactionChanges(original, { categoryId: 11, note: "聚餐" })).toEqual({ note: "聚餐" });
  });

  it("sends null to remove a note, and nothing when there was none", () => {
    expect(transactionChanges(original, { categoryId: 11, note: "  " })).toEqual({ note: null });
    expect(transactionChanges({ category_id: 11, note: null }, { categoryId: 11, note: "" })).toBeNull();
  });
});
