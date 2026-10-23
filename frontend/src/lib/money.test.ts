import { describe, expect, it } from "vitest";

import {
  absolute,
  formatAmount,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  fromCents,
  subtract,
  toCents,
  toChartNumber,
} from "./money";

describe("cents", () => {
  it("parses the API's decimal strings exactly", () => {
    expect(toCents("35.50")).toBe(3550);
    expect(toCents("-12.05")).toBe(-1205);
    expect(toCents("0.00")).toBe(0);
    expect(toCents("7")).toBe(700);
    expect(toCents("7.5")).toBe(750);
    expect(toCents("999999999999.99")).toBe(99999999999999);
  });

  it("does not produce negative zero", () => {
    expect(Object.is(toCents("-0.00"), 0)).toBe(true);
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["", "1,234.50", "1e3", "12.345", "abc", " 1.00"]) {
      expect(() => toCents(bad)).toThrow();
    }
  });

  it("round-trips", () => {
    for (const value of ["0.00", "0.05", "-0.05", "35.50", "-1280.00", "1234567.89"]) {
      expect(fromCents(toCents(value))).toBe(value);
    }
  });

  it("subtracts without float error", () => {
    expect(subtract("0.30", "0.10")).toBe("0.20");
    expect(subtract("100.00", "250.75")).toBe("-150.75");
    expect(absolute("-150.75")).toBe("150.75");
  });
});

describe("formatting", () => {
  it("formats with the base currency", () => {
    expect(formatMoney("1234.50", "CNY")).toBe("¥1,234.50");
    expect(formatMoney("-12.00", "CNY")).toBe("-¥12.00");
    expect(formatMoney("16.90", "USD")).toBe("US$16.90");
  });

  it("keeps every digit of a large amount", () => {
    expect(formatMoney("999999999999.99", "CNY")).toBe("¥999,999,999,999.99");
  });

  it("refuses to format a non-decimal", () => {
    expect(() => formatMoney("NaN", "CNY")).toThrow();
  });

  it("abbreviates for chart axes", () => {
    expect(formatMoneyCompact(15000, "CNY")).toBe("¥1.5万");
    expect(formatMoneyCompact(0, "CNY")).toBe("¥0");
  });

  it("formats percentages", () => {
    expect(formatPercent(0.934)).toBe("93%");
    expect(formatPercent(2.42)).toBe("242%");
    expect(formatPercent(0.4914, true)).toBe("49.1%");
  });

  it("converts for chart geometry", () => {
    expect(toChartNumber("35.50")).toBe(35.5);
  });
});

describe("formatAmount", () => {
  it("leaves the currency sign out and keeps the currency's decimals", () => {
    expect(formatAmount("1234.5", "CNY")).toBe("1,234.50");
    expect(formatAmount("-300.00", "CNY")).toBe("-300.00");
    expect(formatAmount("1200.00", "JPY")).toBe("1,200");
    expect(formatAmount("0.00", "USD")).toBe("0.00");
  });
});
