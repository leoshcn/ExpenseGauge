import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import {
  budgetChanges,
  draftAfterSave,
  effectiveAmount,
  groupLines,
  inputText,
  parseBudgetInput,
  rowState,
  sameBudget,
  sumBudgets,
} from "./model";

const line = (category_id: number, amount: string | null, parent_id = 1): Schemas["BudgetLine"] => ({
  category_id,
  category_name: `c${category_id}`,
  parent_id,
  parent_name: `p${parent_id}`,
  amount,
  effective_from: amount === null ? null : "2026-07",
});

describe("parseBudgetInput", () => {
  it("reads an empty input as no budget, not zero", () => {
    expect(parseBudgetInput("")).toEqual({ valid: true, amount: null });
    expect(parseBudgetInput("   ")).toEqual({ valid: true, amount: null });
  });

  it("reads zero as a real budget", () => {
    expect(parseBudgetInput("0")).toEqual({ valid: true, amount: "0.00" });
    expect(parseBudgetInput("0.00")).toEqual({ valid: true, amount: "0.00" });
  });

  it("normalises to two decimals", () => {
    expect(parseBudgetInput("500")).toEqual({ valid: true, amount: "500.00" });
    expect(parseBudgetInput("12.5")).toEqual({ valid: true, amount: "12.50" });
    expect(parseBudgetInput("12.")).toEqual({ valid: true, amount: "12.00" });
    expect(parseBudgetInput("007")).toEqual({ valid: true, amount: "7.00" });
  });

  it("ignores spaces and thousands separators, accepts full-width digits", () => {
    expect(parseBudgetInput(" 1,200.50 ")).toEqual({ valid: true, amount: "1200.50" });
    expect(parseBudgetInput("１２００．５")).toEqual({ valid: true, amount: "1200.50" });
  });

  it("rejects negatives, three decimals, letters and too many digits", () => {
    for (const text of ["-1", "1.234", "abc", "1e3", ".5", "1234567890123"]) {
      expect(parseBudgetInput(text)).toEqual({ valid: false });
    }
    expect(parseBudgetInput("999999999999.99")).toEqual({ valid: true, amount: "999999999999.99" });
  });
});

describe("sameBudget", () => {
  it("compares by value and keeps null apart from zero", () => {
    expect(sameBudget("500", "500.00")).toBe(true);
    expect(sameBudget(null, null)).toBe(true);
    expect(sameBudget(null, "0.00")).toBe(false);
    expect(sameBudget("0.00", null)).toBe(false);
    expect(sameBudget("1.00", "1.01")).toBe(false);
  });
});

describe("rowState and inputText", () => {
  it("shows the amount in force until the user types", () => {
    expect(inputText(line(11, "500.00"), {})).toBe("500.00");
    expect(inputText(line(11, null), {})).toBe("");
    expect(inputText(line(11, "500.00"), { 11: "" })).toBe("");
    expect(rowState(line(11, "500.00"), {})).toEqual({ parsed: { valid: true, amount: "500.00" }, changed: false });
  });

  it("is unchanged when the typed value equals the one in force", () => {
    expect(rowState(line(11, "500.00"), { 11: "500" }).changed).toBe(false);
    expect(rowState(line(11, null), { 11: "" }).changed).toBe(false);
  });

  it("is changed when a budget is set, altered or cleared", () => {
    expect(rowState(line(11, null), { 11: "0" }).changed).toBe(true);
    expect(rowState(line(11, "0.00"), { 11: "" }).changed).toBe(true);
    expect(rowState(line(11, "500.00"), { 11: "600" }).changed).toBe(true);
  });
});

describe("budgetChanges", () => {
  const lines = [line(11, "500.00"), line(12, null), line(13, "0.00"), line(14, "80.00")];

  it("sends nothing without edits", () => {
    expect(budgetChanges(lines, {})).toEqual({ items: [], invalid: [] });
  });

  it("sends only rows that differ, with null to clear and 0 as a value", () => {
    const draft = { 11: "500", 12: "0", 13: "", 14: "95.5" };
    expect(budgetChanges(lines, draft)).toEqual({
      items: [
        { category_id: 12, amount: "0.00" },
        { category_id: 13, amount: null },
        { category_id: 14, amount: "95.50" },
      ],
      invalid: [],
    });
  });

  it("lists invalid rows separately", () => {
    expect(budgetChanges(lines, { 11: "abc", 14: "90" })).toEqual({
      items: [{ category_id: 14, amount: "90.00" }],
      invalid: [11],
    });
  });

  it("re-diffs the same draft against another month's amounts", () => {
    const draft = { 11: "600" };
    expect(budgetChanges([line(11, "600.00")], draft).items).toEqual([]);
    expect(budgetChanges([line(11, null)], draft).items).toEqual([{ category_id: 11, amount: "600.00" }]);
  });
});

describe("sumBudgets and effectiveAmount", () => {
  it("is null when no amount is set, and counts zero as set", () => {
    expect(sumBudgets([null, null])).toBeNull();
    expect(sumBudgets([])).toBeNull();
    expect(sumBudgets([null, "0.00"])).toBe("0.00");
    expect(sumBudgets(["500.00", null, "0.10", "0.20"])).toBe("500.30");
  });

  it("uses the typed value when valid, else the amount in force", () => {
    expect(effectiveAmount(line(11, "500.00"), { 11: "650" })).toBe("650.00");
    expect(effectiveAmount(line(11, "500.00"), { 11: "" })).toBeNull();
    expect(effectiveAmount(line(11, "500.00"), { 11: "x" })).toBe("500.00");
  });
});

describe("groupLines", () => {
  it("follows the tree's order and keeps level-1 categories without children", () => {
    const tree: Schemas["CategoryTree"] = {
      account_id: 1,
      categories: [
        { id: 2, name: "交通", children: [{ id: 21, name: "地铁", description: null }] },
        { id: 1, name: "餐饮", children: [{ id: 12, name: "外卖", description: null }, { id: 11, name: "买菜", description: null }] },
        { id: 3, name: "空的", children: [] },
      ],
    };
    const lines = [line(11, "1.00"), line(12, null), line(21, "2.00", 2)];
    expect(groupLines(tree, lines).map((group) => [group.name, group.lines.map((l) => l.category_id)])).toEqual([
      ["交通", [21]],
      ["餐饮", [12, 11]],
      ["空的", []],
    ]);
  });
});

describe("draftAfterSave", () => {
  it("drops what was saved and keeps what was typed while the request ran", () => {
    const sent = { 11: "500", 12: "" };
    expect(draftAfterSave(sent, sent)).toEqual({});
    expect(draftAfterSave({ 11: "600", 12: "", 21: "8" }, sent)).toEqual({ 11: "600", 21: "8" });
  });
});
