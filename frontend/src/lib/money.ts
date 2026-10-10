/**
 * Money arrives from the API as a decimal string with two places ("35.50", "-12.00").
 * It is never turned into a float for arithmetic or display: arithmetic runs on integer
 * cents, and `Intl.NumberFormat` formats the decimal string itself. The one float
 * conversion is `toChartNumber`, for chart geometry only.
 */

const DECIMAL = /^(-?)(\d+)(?:\.(\d{1,2}))?$/;
const LOCALE = "zh-CN";

/** "35.50" -> 3550. NUMERIC(14,2) is at most 1e14 cents, well inside the safe integers. */
export function toCents(value: string): number {
  const match = DECIMAL.exec(value);
  if (!match) throw new Error(`Not a money string: ${JSON.stringify(value)}`);
  const [, sign, whole = "0", fraction = ""] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return sign === "-" && cents !== 0 ? -cents : cents;
}

/** 3550 -> "35.50" */
export function fromCents(cents: number): string {
  const absolute = Math.abs(cents);
  const whole = Math.trunc(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, "0");
  return `${cents < 0 ? "-" : ""}${whole}.${fraction}`;
}

export function subtract(a: string, b: string): string {
  return fromCents(toCents(a) - toCents(b));
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}:${compact}`;
  let cached = formatters.get(key);
  if (!cached) {
    // `symbol` rather than `narrowSymbol`: in zh-CN it gives ¥ for CNY but JP¥, US$ and
    // HK$ for the others, so two accounts never show the same sign for different money.
    cached = new Intl.NumberFormat(LOCALE, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      ...(compact ? { notation: "compact", maximumFractionDigits: 1 } : {}),
    });
    formatters.set(key, cached);
  }
  return cached;
}

/** Full precision, for every figure the user reads: "¥1,234.50". */
export function formatMoney(value: string, currency: string): string {
  toCents(value); // reject anything that is not a plain decimal before formatting it
  return formatter(currency, false).format(value as Intl.StringNumericLiteral);
}

/** Abbreviated, for chart axes only: "¥1.2万". */
export function formatMoneyCompact(value: number, currency: string): string {
  return formatter(currency, true).format(value);
}

/** For chart geometry only. Never format or sum the result. */
export function toChartNumber(value: string): number {
  return toCents(value) / 100;
}

const percent = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 0 });
const percentFine = new Intl.NumberFormat(LOCALE, {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

export function formatPercent(ratio: number, fine = false): string {
  return (fine ? percentFine : percent).format(ratio);
}

/** "-12.50" -> "12.50" */
export function absolute(value: string): string {
  return fromCents(Math.abs(toCents(value)));
}
