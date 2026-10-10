import { describe, expect, it } from "vitest";

import { addMonths, isMonth, monthElapsed, monthOf, monthRange, parseMonth } from "./month";

describe("month", () => {
  it("recognises YYYY-MM only", () => {
    expect(isMonth("2026-10")).toBe(true);
    for (const bad of ["2026-13", "2026-1", "2026-00", "26-10", "", null, undefined]) {
      expect(isMonth(bad)).toBe(false);
    }
  });

  it("parses", () => {
    expect(parseMonth("2026-03")).toEqual({ year: 2026, month: 3 });
    expect(() => parseMonth("2026-3")).toThrow();
  });

  it("adds months across year boundaries", () => {
    expect(addMonths("2026-10", -11)).toBe("2025-11");
    expect(addMonths("2025-12", 1)).toBe("2026-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(addMonths("2026-05", 0)).toBe("2026-05");
  });

  it("lists an inclusive range", () => {
    expect(monthRange("2025-11", "2026-02")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(monthRange("2026-02", "2026-01")).toEqual([]);
  });

  it("takes the month from local time", () => {
    expect(monthOf(new Date(2026, 9, 10))).toBe("2026-10");
    expect(monthOf(new Date(2026, 0, 1))).toBe("2026-01");
  });

  it("reports how much of the current month has passed, and nothing for other months", () => {
    const now = new Date(2026, 9, 10);
    expect(monthElapsed("2026-10", now)).toBeCloseTo(10 / 31);
    expect(monthElapsed("2026-09", now)).toBeNull();
    expect(monthElapsed("2026-02", new Date(2026, 1, 28))).toBe(1);
  });
});
