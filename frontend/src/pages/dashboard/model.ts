/** Pure derivations for the Dashboard. No React, no fetching; unit-tested in model.test.ts. */

import type { Schemas } from "@/api/client";
import { usage } from "@/lib/budget";
import { fromCents, toCents, toChartNumber } from "@/lib/money";
import { parseMonth } from "@/lib/month";

export type TrendPoint = {
  month: string;
  monthNumber: number;
  year: number;
  /** Chart geometry only. */
  budget: number | null;
  /** Monthly budget accounts only; `over` compares it with `budget`. */
  actual: number;
  /** Annual budget accounts' spending of the month, stacked on `actual`; 0 when none. */
  annual: number;
  over: boolean;
  /** The API's own strings, for the tooltip. */
  budgetText: string | null;
  actualText: string;
  annualText: string;
};

export function trendPoints(months: readonly Schemas["MonthTotal"][]): TrendPoint[] {
  return months.map((entry) => {
    const { year, month } = parseMonth(entry.month);
    return {
      month: entry.month,
      monthNumber: month,
      year,
      budget: entry.budget === null ? null : toChartNumber(entry.budget),
      actual: toChartNumber(entry.actual),
      annual: toChartNumber(entry.annual_actual),
      over: usage(entry.budget, entry.actual).state === "over",
      budgetText: entry.budget,
      actualText: entry.actual,
      annualText: entry.annual_actual,
    };
  });
}

/** True when some month has annual spending, so the chart stacks a second segment. */
export function hasAnnual(points: readonly TrendPoint[]): boolean {
  return points.some((point) => point.annual !== 0);
}

/**
 * Round axis ticks from 0 to just above `max`, at most `intervals` steps of 1, 2, 2.5 or
 * 5 times a power of ten. Undefined when a value is negative (a month where refunds
 * outweigh spending): the chart then picks its own domain.
 */
export function niceTicks(points: readonly TrendPoint[], intervals = 4): number[] | undefined {
  if (points.some((point) => point.actual < 0 || point.annual < 0)) return undefined;
  return niceTicksOf(
    points.flatMap((point) => [point.actual + point.annual, point.budget ?? 0]),
    intervals,
  );
}

/** `niceTicks` for any list of chart values. */
export function niceTicksOf(values: readonly number[], intervals = 4): number[] | undefined {
  if (values.some((value) => value < 0)) return undefined;
  const max = Math.max(...values, 0);
  if (max === 0) return [0, 1];
  const raw = max / intervals;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * power).find((size) => size >= raw)!;
  const count = Math.ceil(max / step);
  return Array.from({ length: count + 1 }, (_, index) => index * step);
}

/**
 * True when the whole window holds no spending at all: the scope has no transactions yet.
 * Annual accounts' spending counts too ("全部" keeps it out of `actual`).
 */
export function isWindowEmpty(months: readonly Schemas["MonthTotal"][]): boolean {
  return months.every((entry) => toCents(entry.actual) === 0 && toCents(entry.annual_actual) === 0);
}

export type AnnualTrendPoint = {
  month: string;
  monthNumber: number;
  year: number;
  /** Chart geometry only; null after `through` (nothing is drawn for those months). */
  actual: number | null;
  cumulative: number | null;
  /** Where spending would be if the annual budget were used evenly: budget × month / 12. */
  pace: number | null;
  /** The API's own string and exact sums, for the tooltip. */
  actualText: string | null;
  cumulativeText: string | null;
};

/**
 * The twelve months of an annual budget account's year: each month's actual and the
 * running total up to `through` (the account's `months`), the even-pace line for all
 * twelve when there is a budget.
 */
export function annualTrendPoints(
  year: number,
  months: readonly Schemas["AnnualMonth"][],
  budget: string | null,
): AnnualTrendPoint[] {
  const byMonth = new Map(months.map((entry) => [entry.month, entry.actual]));
  const budgetCents = budget === null ? null : toCents(budget);
  let running = 0;
  return Array.from({ length: 12 }, (_, index) => {
    const monthNumber = index + 1;
    const month = `${String(year).padStart(4, "0")}-${String(monthNumber).padStart(2, "0")}`;
    const actual = byMonth.get(month);
    if (actual !== undefined) running += toCents(actual);
    return {
      month,
      monthNumber,
      year,
      actual: actual === undefined ? null : toChartNumber(actual),
      cumulative: actual === undefined ? null : running / 100,
      pace: budgetCents === null ? null : Math.round((budgetCents * monthNumber) / 12) / 100,
      actualText: actual ?? null,
      cumulativeText: actual === undefined ? null : fromCents(running),
    };
  });
}

export const CHART_COLOR_COUNT = 8;
const OTHER_COLOR = CHART_COLOR_COUNT;

/** Colour slot (1-based `--chart-N`) for the level-1 category at `index` in API order. */
export function colorSlot(index: number): number {
  return (index % (CHART_COLOR_COUNT - 1)) + 1;
}

export type ShareSlice = {
  key: string;
  /** null for the "other" slice; the caller supplies its label. */
  name: string | null;
  amount: string;
  /** Chart geometry only. */
  value: number;
  share: number;
  colorSlot: number;
};

export type Shares = {
  slices: ShareSlice[];
  /** Sum of the slices: positive level-1 actuals only. */
  total: string;
  /** Categories left out because refunds outweigh spending this month. */
  excluded: number;
};

/**
 * Level-1 shares of the month's spending, largest first. A category keeps the colour of
 * its position in the API's order, so it does not change colour from month to month.
 * Beyond `maxSlices` the smallest are merged into one "other" slice.
 */
export function shares(categories: readonly Schemas["Level1Row"][], maxSlices = 7): Shares {
  const positive = categories
    .map((category, index) => ({ category, index, cents: toCents(category.actual) }))
    .filter((entry) => entry.cents > 0)
    .sort((a, b) => b.cents - a.cents || a.index - b.index);
  const totalCents = positive.reduce((sum, entry) => sum + entry.cents, 0);
  const excluded = categories.filter((category) => toCents(category.actual) < 0).length;

  const head = positive.length > maxSlices ? positive.slice(0, maxSlices - 1) : positive;
  const tail = positive.slice(head.length);
  const slices: ShareSlice[] = head.map((entry) => ({
    key: String(entry.category.category_id),
    name: entry.category.name,
    amount: entry.category.actual,
    value: entry.cents / 100,
    share: entry.cents / totalCents,
    colorSlot: colorSlot(entry.index),
  }));
  if (tail.length > 0) {
    const cents = tail.reduce((sum, entry) => sum + entry.cents, 0);
    slices.push({
      key: "other",
      name: null,
      amount: fromCents(cents),
      value: cents / 100,
      share: cents / totalCents,
      colorSlot: OTHER_COLOR,
    });
  }
  return { slices, total: fromCents(totalCents), excluded };
}
