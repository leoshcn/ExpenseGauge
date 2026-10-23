/** Pure logic of the reports page: date ranges, chart slices, the pace series, the calendar. */

import type { Schemas } from "@/api/client";
import { fromCents, toCents } from "@/lib/money";
import { addMonths, isMonth, monthOf, parseMonth } from "@/lib/month";

export type ReportConfig = Schemas["SavedReportConfig"];
export type RangePreset = ReportConfig["range"]["preset"];
export type ChartKind = ReportConfig["chart"];
export type Mode = ReportConfig["mode"];

export const PRESETS: readonly RangePreset[] = ["this_month", "last_3", "last_6", "last_12", "this_year", "custom"];
export const GROUP_BYS: readonly ReportConfig["group_by"][] = ["level1", "level2", "counterparty", "channel", "tag"];
/** The charts each mode offers; the table is always shown below. */
export const CHARTS: Record<Mode, readonly ChartKind[]> = {
  total: ["bar", "donut", "table"],
  monthly: ["bar", "line", "table"],
};
/** Groups drawn in a chart; the rest are summed into "其他". */
export const CHART_GROUPS = 7;

/** The inclusive months of a range ending at `now`'s month (or the custom months, ordered). */
export function rangeMonths(range: ReportConfig["range"], now: Date): { from: string; to: string } {
  const current = monthOf(now);
  switch (range.preset) {
    case "this_month":
      return { from: current, to: current };
    case "last_3":
      return { from: addMonths(current, -2), to: current };
    case "last_6":
      return { from: addMonths(current, -5), to: current };
    case "last_12":
      return { from: addMonths(current, -11), to: current };
    case "this_year":
      return { from: `${parseMonth(current).year}-01`, to: current };
    case "custom": {
      const from = range.from_month && isMonth(range.from_month) ? range.from_month : current;
      const to = range.to_month && isMonth(range.to_month) ? range.to_month : current;
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** The report's settings from the URL; anything unreadable falls back to a default. */
export function readConfig(params: URLSearchParams): ReportConfig {
  const group = params.get("group");
  const preset = params.get("range");
  const mode: Mode = params.get("mode") === "monthly" ? "monthly" : "total";
  const chart = params.get("chart");
  return {
    group_by: GROUP_BYS.find((value) => value === group) ?? "level1",
    mode,
    range: {
      preset: PRESETS.find((value) => value === preset) ?? "last_3",
      from_month: isMonth(params.get("from")) ? params.get("from") : null,
      to_month: isMonth(params.get("to")) ? params.get("to") : null,
    },
    budget_account_id: null,
    chart: CHARTS[mode].find((value) => value === chart) ?? "bar",
  };
}

/** The URL parameters for `config` (defaults left out), to apply a saved report. */
export function configParams(config: ReportConfig): Record<string, string | null> {
  return {
    group: config.group_by === "level1" ? null : config.group_by,
    mode: config.mode === "total" ? null : config.mode,
    range: config.range.preset === "last_3" ? null : config.range.preset,
    from: config.range.preset === "custom" ? (config.range.from_month ?? null) : null,
    to: config.range.preset === "custom" ? (config.range.to_month ?? null) : null,
    chart: config.chart === "bar" ? null : config.chart,
  };
}

/** Whether two configs are the same report (to tell whether a saved one was changed). */
export function sameConfig(a: ReportConfig, b: ReportConfig): boolean {
  return JSON.stringify(configParams(a)) === JSON.stringify(configParams(b)) && a.budget_account_id === b.budget_account_id;
}

export type ChartGroup = { key: string; label: string | null; other: boolean; amount: string; months: string[]; slot: number };

/**
 * The groups a chart draws: the largest `CHART_GROUPS` with a positive amount, then one
 * "其他" summing the rest. `slot` is the colour (`--chart-N`, 8 = 其他).
 */
export function chartGroups(groups: readonly Schemas["ReportGroup"][], monthCount: number): ChartGroup[] {
  const positive = groups.filter((group) => toCents(group.amount) > 0);
  const shown = positive.slice(0, CHART_GROUPS).map((group, index) => ({
    key: `g${index}`,
    label: group.label,
    other: false,
    amount: group.amount,
    months: group.months,
    slot: index + 1,
  }));
  const rest = positive.slice(CHART_GROUPS);
  if (rest.length > 0) {
    const months = Array.from({ length: monthCount }, (_, index) =>
      fromCents(rest.reduce((sum, group) => sum + toCents(group.months[index] ?? "0"), 0)),
    );
    shown.push({
      key: "other",
      label: null,
      other: true,
      amount: fromCents(rest.reduce((sum, group) => sum + toCents(group.amount), 0)),
      months,
      slot: 8,
    });
  }
  return shown;
}

function daysIn(month: string): number {
  const { year, month: m } = parseMonth(month);
  return new Date(Date.UTC(year, m, 0)).getUTCDate();
}

/** Cumulative amount per day of `month` (index 0 = day 1), in cents. */
function cumulative(days: readonly Schemas["DailyAmount"][], month: string): number[] {
  const series = new Array<number>(daysIn(month)).fill(0);
  for (const day of days) {
    if (!day.date.startsWith(month)) continue;
    series[Number(day.date.slice(8, 10)) - 1]! += toCents(day.amount);
  }
  for (let index = 1; index < series.length; index += 1) series[index]! += series[index - 1]!;
  return series;
}

export type PacePoint = { day: number; current: number | null; previous: number | null; average: number | null };

/**
 * Cumulative spending by day of the month for `month` (to today when it is the current
 * month), the month before, and the average of the 3 months before (each day by its
 * number; a shorter month keeps its last total). Values are in currency units, for chart
 * geometry only.
 */
export function paceSeries(days: readonly Schemas["DailyAmount"][], month: string, now: Date): PacePoint[] {
  const length = 31;
  const current = cumulative(days, month);
  const before = [1, 2, 3].map((back) => cumulative(days, addMonths(month, -back)));
  const today = monthOf(now) === month ? now.getDate() : current.length;
  const at = (series: number[], index: number) => series[Math.min(index, series.length - 1)]!;
  return Array.from({ length }, (_, index) => ({
    day: index + 1,
    current: index < current.length && index < today ? at(current, index) / 100 : null,
    previous: at(before[0]!, index) / 100,
    average: before.reduce((sum, series) => sum + at(series, index), 0) / 3 / 100,
  }));
}

/** The month's days in weeks starting on Monday; `null` pads the first and last week. */
export function calendarWeeks(month: string): (string | null)[][] {
  const { year, month: m } = parseMonth(month);
  const first = new Date(Date.UTC(year, m - 1, 1)).getUTCDay(); // 0 = Sunday
  const lead = (first + 6) % 7;
  const cells: (string | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysIn(month); day += 1) {
    cells.push(`${month}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** 0 (nothing) to 4 (the month's largest day), on a square-root scale so small days show. */
export function heatLevel(amount: string | undefined, max: number): number {
  if (amount === undefined || max <= 0) return 0;
  const cents = toCents(amount);
  if (cents <= 0) return 0;
  return Math.max(1, Math.ceil(Math.sqrt(cents / max) * 4));
}
