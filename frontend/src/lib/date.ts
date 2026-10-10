/** Dates from the API: `YYYY-MM-DD` for a transaction's day, ISO 8601 for timestamps. */

import { parseMonth } from "@/lib/month";
import { S } from "@/strings.zh";

/** "2026-10" -> "2026年10月", as the Dashboard writes months. */
export function formatMonth(month: string): string {
  const { year, month: number } = parseMonth(month);
  return S.dashboard.month.long(year, number);
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-10-08" -> "10月8日", or "2025年12月3日" outside the year of `now`. The string is
 * read as a calendar day, never through `Date`, so no time zone can move it.
 */
export function formatDay(value: string, now: Date): string {
  const match = DAY.exec(value);
  if (!match) return value;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return year === now.getFullYear() ? S.date.day(month, day) : S.date.dayWithYear(year, month, day);
}

const dateTime = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** An instant in the browser's time zone: "2026年10月10日 14:32". */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : dateTime.format(date);
}
