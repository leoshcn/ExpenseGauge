/** A month travels as `YYYY-MM`, the same form the API uses. */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH.test(value);
}

export function parseMonth(value: string): { year: number; month: number } {
  const match = MONTH.exec(value);
  if (!match) throw new Error(`Not a month: ${JSON.stringify(value)}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

function fromIndex(index: number): string {
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, "0")}-${String((index % 12) + 1).padStart(2, "0")}`;
}

function toIndex(value: string): number {
  const { year, month } = parseMonth(value);
  return year * 12 + (month - 1);
}

/** The month of `now` in the browser's time zone. */
export function monthOf(now: Date): string {
  return fromIndex(now.getFullYear() * 12 + now.getMonth());
}

export function addMonths(value: string, count: number): string {
  return fromIndex(toIndex(value) + count);
}

/** Inclusive list of months from `from` to `to`. */
export function monthRange(from: string, to: string): string[] {
  const result: string[] = [];
  for (let index = toIndex(from); index <= toIndex(to); index += 1) result.push(fromIndex(index));
  return result;
}

/** Share of `month` that has passed at `now` (0..1), or null when `month` is not the current one. */
export function monthElapsed(month: string, now: Date): number | null {
  if (monthOf(now) !== month) return null;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return now.getDate() / daysInMonth;
}
