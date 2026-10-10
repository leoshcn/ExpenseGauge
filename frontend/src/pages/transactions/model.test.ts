import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import {
  findCategory,
  isRefund,
  monthOptions,
  PAGE_SIZE,
  pageRange,
  readFilter,
  transactionChanges,
} from "./model";

const tree: Schemas["CategoryTree"] = {
  account_id: 1,
  categories: [
    { id: 1, name: "餐饮", children: [{ id: 11, name: "买菜" }, { id: 12, name: "外卖" }] },
    { id: 2, name: "交通", children: [] },
  ],
};

describe("readFilter", () => {
  it("reads month, category and page", () => {
    const params = new URLSearchParams("month=2026-09&category=12&page=3");
    expect(readFilter(params, tree)).toEqual({ month: "2026-09", categoryId: 12, page: 3, pageSize: PAGE_SIZE });
  });

  it("accepts a level-1 category", () => {
    expect(readFilter(new URLSearchParams("category=1"), tree).categoryId).toBe(1);
  });

  it("falls back on anything it cannot use", () => {
    const params = new URLSearchParams("month=2026-13&category=99&page=-1");
    expect(readFilter(params, tree)).toEqual({ month: null, categoryId: null, page: 1, pageSize: PAGE_SIZE });
    expect(readFilter(new URLSearchParams("category=abc&page=1.5"), tree)).toMatchObject({
      categoryId: null,
      page: 1,
    });
  });

  it("keeps the category until the tree is known", () => {
    expect(readFilter(new URLSearchParams("category=99"), undefined).categoryId).toBe(99);
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
