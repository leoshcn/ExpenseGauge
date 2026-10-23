import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { calendarWeeks, chartGroups, configParams, heatLevel, paceSeries, rangeMonths, readConfig } from "./model";

const now = new Date(2026, 9, 23);

describe("rangeMonths", () => {
  it("ends at the current month", () => {
    expect(rangeMonths({ preset: "this_month" }, now)).toEqual({ from: "2026-10", to: "2026-10" });
    expect(rangeMonths({ preset: "last_3" }, now)).toEqual({ from: "2026-08", to: "2026-10" });
    expect(rangeMonths({ preset: "last_12" }, now)).toEqual({ from: "2025-11", to: "2026-10" });
    expect(rangeMonths({ preset: "this_year" }, now)).toEqual({ from: "2026-01", to: "2026-10" });
  });

  it("orders custom months and falls back to the current month", () => {
    expect(rangeMonths({ preset: "custom", from_month: "2026-09", to_month: "2026-03" }, now)).toEqual({
      from: "2026-03",
      to: "2026-09",
    });
    expect(rangeMonths({ preset: "custom", from_month: "x", to_month: null }, now)).toEqual({
      from: "2026-10",
      to: "2026-10",
    });
  });
});

describe("readConfig / configParams", () => {
  it("reads the URL with defaults and writes back only what differs", () => {
    const config = readConfig(new URLSearchParams("group=tag&mode=monthly&range=custom&from=2026-01&to=2026-03&chart=donut"));
    expect(config).toEqual({
      group_by: "tag",
      mode: "monthly",
      range: { preset: "custom", from_month: "2026-01", to_month: "2026-03" },
      budget_account_id: null,
      chart: "bar", // a donut is for totals only
    });
    expect(configParams(readConfig(new URLSearchParams()))).toEqual({
      group: null,
      mode: null,
      range: null,
      from: null,
      to: null,
      chart: null,
    });
  });
});

describe("chartGroups", () => {
  it("keeps the 7 largest positive groups and sums the rest into 其他", () => {
    const groups: Schemas["ReportGroup"][] = Array.from({ length: 9 }, (_, index) => ({
      key: String(index),
      label: `g${index}`,
      amount: `${100 - index}.00`,
      count: 1,
      months: [`${100 - index}.00`],
    }));
    groups.push({ key: "neg", label: "退款", amount: "-5.00", count: 0, months: ["-5.00"] });
    const shown = chartGroups(groups, 1);
    expect(shown).toHaveLength(8);
    expect(shown.at(-1)).toMatchObject({ other: true, amount: "185.00", months: ["185.00"], slot: 8 });
  });
});

describe("paceSeries", () => {
  it("accumulates by day, stops the current month at today and averages 3 months", () => {
    const days: Schemas["DailyAmount"][] = [
      { date: "2026-10-01", amount: "10.00" },
      { date: "2026-10-20", amount: "5.00" },
      { date: "2026-09-02", amount: "30.00" },
      { date: "2026-08-31", amount: "60.00" },
      { date: "2026-07-01", amount: "90.00" },
    ];
    const series = paceSeries(days, "2026-10", now);
    expect(series[0]).toEqual({ day: 1, current: 10, previous: 0, average: 30 });
    expect(series[22]).toMatchObject({ current: 15, previous: 30 });
    expect(series[23]!.current).toBeNull();
    // September has 30 days: day 31 keeps its total; August reaches 60 on the 31st.
    expect(series[30]).toMatchObject({ previous: 30, average: 60 });
  });
});

describe("calendarWeeks and heatLevel", () => {
  it("lays out a month in Monday-first weeks", () => {
    const weeks = calendarWeeks("2026-10"); // 1 October 2026 is a Thursday
    expect(weeks[0]).toEqual([null, null, null, "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04"]);
    expect(weeks.flat().filter(Boolean)).toHaveLength(31);
  });

  it("scales amounts to 0-4", () => {
    expect(heatLevel(undefined, 10000)).toBe(0);
    expect(heatLevel("-5.00", 10000)).toBe(0);
    expect(heatLevel("100.00", 10000)).toBe(4);
    expect(heatLevel("1.00", 10000)).toBe(1);
  });
});
