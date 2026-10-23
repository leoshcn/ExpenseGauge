import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import {
  annualTrendPoints,
  barStart,
  budgetEditText,
  gridMonths,
  hasAnnual,
  isWindowEmpty,
  mergeGridRows,
  niceTicks,
  shares,
  trendPoints,
} from "./model";

const month = (
  m: string,
  budget: string | null,
  actual: string,
  annual_actual = "0.00",
): Schemas["MonthTotal"] => ({
  month: m,
  budget,
  actual,
  annual_actual,
});

const row = (id: number, name: string, actual: string): Schemas["Level1Row"] => ({
  category_id: id,
  name,
  count: 0,
  budget: null,
  actual,
  children: [],
});

describe("trendPoints", () => {
  it("keeps the API strings and marks over-budget months", () => {
    const points = trendPoints([
      month("2025-12", null, "0.00"),
      month("2026-01", "15000.00", "16200.50"),
      month("2026-02", "15000.00", "9000.00"),
    ]);
    expect(points[0]).toMatchObject({ year: 2025, monthNumber: 12, budget: null, over: false });
    expect(points[1]).toMatchObject({ budget: 15000, actual: 16200.5, over: true, actualText: "16200.50" });
    expect(points[2]?.over).toBe(false);
  });
});

describe("niceTicks", () => {
  const ticks = (...actuals: string[]) =>
    niceTicks(trendPoints(actuals.map((actual, index) => month(`2026-0${index + 1}`, null, actual))));

  it("gives round steps that cover the maximum", () => {
    expect(ticks("16200.00", "9000.00")).toEqual([0, 5000, 10000, 15000, 20000]);
    expect(ticks("83.00")).toEqual([0, 25, 50, 75, 100]);
    expect(ticks("400.00")).toEqual([0, 100, 200, 300, 400]);
  });

  it("covers the budget when it is the largest value", () => {
    const points = trendPoints([month("2026-01", "15320.00", "100.00")]);
    expect(niceTicks(points)?.at(-1)).toBe(20000);
  });

  it("handles an empty window and leaves negative data to the chart", () => {
    expect(ticks("0.00")).toEqual([0, 1]);
    expect(ticks("-185.00", "500.00")).toBeUndefined();
  });
});

describe("isWindowEmpty", () => {
  it("is true only when no month has spending", () => {
    expect(isWindowEmpty([month("2026-01", "5000.00", "0.00"), month("2026-02", null, "0.00")])).toBe(true);
    expect(isWindowEmpty([month("2026-01", null, "0.00"), month("2026-02", null, "-5.00")])).toBe(false);
  });
});

describe("shares", () => {
  it("orders by amount and keeps each category's colour slot from the API order", () => {
    const result = shares([row(1, "餐饮", "250.00"), row(2, "居住", "700.00"), row(3, "交通", "50.00")]);
    expect(result.total).toBe("1000.00");
    expect(result.slices.map((slice) => [slice.name, slice.share, slice.colorSlot])).toEqual([
      ["居住", 0.7, 2],
      ["餐饮", 0.25, 1],
      ["交通", 0.05, 3],
    ]);
  });

  it("leaves out zero and negative categories and counts the negative ones", () => {
    const result = shares([row(1, "餐饮", "300.00"), row(2, "购物", "-185.00"), row(3, "旅行", "0.00")]);
    expect(result.slices.map((slice) => slice.name)).toEqual(["餐饮"]);
    expect(result.total).toBe("300.00");
    expect(result.excluded).toBe(1);
  });

  it("merges the smallest into one 'other' slice beyond the limit", () => {
    const rows = Array.from({ length: 9 }, (_, index) => row(index + 1, `分类${index + 1}`, `${(9 - index) * 10}.00`));
    const result = shares(rows);
    expect(result.slices).toHaveLength(7);
    expect(result.slices.at(-1)).toMatchObject({ key: "other", name: null, amount: "60.00", colorSlot: 8 });
    expect(result.slices.reduce((sum, slice) => sum + slice.share, 0)).toBeCloseTo(1);
  });

  it("is empty when nothing was spent", () => {
    expect(shares([row(1, "餐饮", "0.00")])).toEqual({ slices: [], total: "0.00", excluded: 0 });
  });
});

describe("annual spending in the trend", () => {
  it("stacks annual spending apart from the monthly actual, which alone is compared with the budget", () => {
    const [point] = trendPoints([month("2026-03", "6000.00", "5000.00", "6000.00")]);
    expect(point).toMatchObject({ actual: 5000, annual: 6000, over: false, annualText: "6000.00" });
    expect(hasAnnual([point!])).toBe(true);
    expect(hasAnnual(trendPoints([month("2026-03", null, "1.00")]))).toBe(false);
    // The axis covers the stacked height (11000), not just the monthly part.
    expect(niceTicks([point!])).toEqual([0, 5000, 10000, 15000]);
  });

  it("does not call a window empty when only annual accounts spent", () => {
    expect(isWindowEmpty([month("2026-03", null, "0.00", "120.00")])).toBe(false);
  });

  it("builds the annual year: actual and running total through the last month, pace for all twelve", () => {
    const points = annualTrendPoints(
      2026,
      [
        { month: "2026-01", actual: "6000.00" },
        { month: "2026-02", actual: "0.00" },
        { month: "2026-03", actual: "2000.00" },
      ],
      "30000.00",
    );
    expect(points).toHaveLength(12);
    expect(points[2]).toMatchObject({ month: "2026-03", actual: 2000, cumulative: 8000, pace: 7500, cumulativeText: "8000.00" });
    expect(points[3]).toMatchObject({ month: "2026-04", actual: null, cumulative: null, pace: 10000 });
    expect(points[11]?.pace).toBe(30000);
    expect(annualTrendPoints(2026, [], null)[0]?.pace).toBeNull();
  });
});

const leaf = (id: number, name: string, actual: string): Schemas["Level2Row"] => ({
  category_id: id,
  name,
  budget: null,
  actual,
  count: 0,
});
const parent = (id: number, name: string, children: Schemas["Level2Row"][]): Schemas["Level1Row"] => ({
  ...row(id, name, "0.00"),
  children,
});

describe("gridMonths", () => {
  it("ends at the month, oldest first, across a year boundary", () => {
    expect(gridMonths("2026-10")).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(gridMonths("2026-01")).toEqual(["2025-11", "2025-12", "2026-01"]);
  });
});

describe("mergeGridRows", () => {
  it("lines the months up by category in the selected month's order", () => {
    const rows = mergeGridRows([
      { categories: [parent(1, "餐饮", [leaf(11, "早餐", "10.00"), leaf(12, "午餐", "20.00")])] },
      { categories: [parent(1, "餐饮", [leaf(12, "午餐", "21.00"), leaf(11, "早饭", "11.00")])] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.children.map((child) => child.name)).toEqual(["午餐", "早饭"]);
    expect(rows[0]!.children[1]!.months.map((month) => month?.actual)).toEqual(["10.00", "11.00"]);
  });

  it("keeps categories only an earlier month has, after the others", () => {
    const rows = mergeGridRows([
      { categories: [parent(1, "餐饮", [leaf(11, "早餐", "10.00")]), parent(2, "旧分类", [leaf(21, "x", "5.00")])] },
      { categories: [parent(1, "餐饮", [leaf(12, "午餐", "20.00")])] },
      { categories: [parent(3, "交通", []), parent(1, "餐饮", [leaf(12, "午餐", "30.00")])] },
    ]);
    expect(rows.map((r) => r.name)).toEqual(["交通", "餐饮", "旧分类"]);
    const dining = rows[1]!;
    expect(dining.children.map((child) => child.category_id)).toEqual([12, 11]);
    expect(dining.children[1]!.months.map((month) => month?.actual ?? null)).toEqual(["10.00", null, null]);
    expect(rows[2]!.months.map((month) => month !== null)).toEqual([true, false, false]);
  });
});

describe("budgetEditText", () => {
  it("drops whole-unit decimals and leaves no budget empty", () => {
    expect(budgetEditText("1500.00")).toBe("1500");
    expect(budgetEditText("12.50")).toBe("12.50");
    expect(budgetEditText("0.00")).toBe("0");
    expect(budgetEditText(null)).toBe("");
  });
});

describe("barStart", () => {
  const at = (month: string) => barStart(month, "2026-10", "2025-11", "2027-10");
  it("shows two months ahead by default", () => {
    expect(at("2026-10")).toBe("2026-01");
    expect(at("2026-01")).toBe("2026-01");
    expect(at("2026-12")).toBe("2026-01");
  });
  it("slides just enough to reach the month, within the range", () => {
    expect(at("2027-01")).toBe("2026-02");
    expect(at("2027-10")).toBe("2026-11");
    expect(at("2025-12")).toBe("2025-12");
    expect(at("2025-11")).toBe("2025-11");
  });
});
