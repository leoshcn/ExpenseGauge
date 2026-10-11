import { S } from "@/strings.zh";

type CurrencyCode = keyof typeof S.currencies;

/** The base currencies offered in onboarding and settings. */
export const CURRENCIES: readonly string[] = Object.keys(S.currencies);

/** The default base currency offered in onboarding. */
export const DEFAULT_CURRENCY = "CNY";

/** The Chinese name of a currency, or the code itself when it is not one of the offered ones. */
export function currencyName(code: string): string {
  return code in S.currencies ? S.currencies[code as CurrencyCode] : code;
}
