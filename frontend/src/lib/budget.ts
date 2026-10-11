/** How spending compares with a budget. Shared by every view that shows a budget. */

import { formatPercent, fromCents, toCents } from "@/lib/money";
import { monthOf, parseMonth } from "@/lib/month";

export type BudgetState = "none" | "ok" | "near" | "over";

/** At or above this share of the budget a category counts as "near". */
export const NEAR_THRESHOLD = 0.85;

export type Usage = {
  state: BudgetState;
  /** budget - actual as a money string (negative when over); null without a budget. */
  remaining: string | null;
  /** actual / budget; null without a budget or with a zero budget. */
  ratio: number | null;
};

/**
 * `budget` null means "no budget" and is not the same as "0.00", which is a real budget
 * that any spending exceeds.
 */
export function usage(budget: string | null, actual: string): Usage {
  if (budget === null) return { state: "none", remaining: null, ratio: null };
  const budgetCents = toCents(budget);
  const actualCents = toCents(actual);
  const remaining = fromCents(budgetCents - actualCents);
  const ratio = budgetCents > 0 ? actualCents / budgetCents : null;
  if (actualCents > budgetCents) return { state: "over", remaining, ratio };
  if (ratio !== null && ratio >= NEAR_THRESHOLD) return { state: "near", remaining, ratio };
  return { state: "ok", remaining, ratio };
}

/** "128%", or null when there is nothing to divide by (no budget, or a budget of zero). */
export function usagePercent(used: Usage): string | null {
  return used.ratio === null ? null : formatPercent(Math.max(used.ratio, 0));
}

/**
 * Share of the calendar year covered by an annual budget's view "through" a month (0..1),
 * the time marker on annual meters. For the current month it is today's position in the
 * year (today counts as passed, as in `monthElapsed`); for any other month it is whole
 * months, `month / 12` (through March = 25%).
 */
export function yearProgress(through: string, now: Date): number {
  const { year, month } = parseMonth(through);
  if (monthOf(now) !== through) return month / 12;
  const startOfYear = Date.UTC(year, 0, 1);
  const today = Date.UTC(year, now.getMonth(), now.getDate());
  const daysInYear = (Date.UTC(year + 1, 0, 1) - startOfYear) / 86_400_000;
  const dayOfYear = (today - startOfYear) / 86_400_000 + 1;
  return dayOfYear / daysInYear;
}

export function countByState(rows: readonly { budget: string | null; actual: string }[]) {
  const counts: Record<BudgetState, number> = { none: 0, ok: 0, near: 0, over: 0 };
  for (const row of rows) counts[usage(row.budget, row.actual).state] += 1;
  return counts;
}
