import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { isWindowEmpty, niceTicks, shares, trendPoints } from "./model";

const month = (m: string, budget: string | null, actual: string): Schemas["MonthTotal"] => ({
  month: m,
  budget,
  actual,
});

const row = (id: number, name: string, actual: string): Schemas["Level1Row"] => ({
  category_id: id,
  name,
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
