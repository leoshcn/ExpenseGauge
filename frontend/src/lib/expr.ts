/**
 * Arithmetic in amount inputs ("1800*1.1", "(300+250)/2"). A small recursive-descent
 * parser over `+ - * / ( )` and decimal numbers; never `eval`. The value is computed in
 * floating point and rounded half away from zero to cents, which is exact for the
 * amounts people type (a handful of operations on two-decimal numbers).
 */

import { fromCents } from "@/lib/money";

export type ExprResult = { ok: true; value: string } | { ok: false };

/** True when the text uses an operator, i.e. is a calculation rather than one amount. */
export function isExpression(text: string): boolean {
  return /[-+*/×÷()（）]/.test(text);
}

const MAX_CENTS = 1e14; // NUMERIC(14,2)

/**
 * The value of `text` as a money string ("1980.00"), or `{ ok: false }` when it is not a
 * well-formed expression, divides by zero or overflows NUMERIC(14,2). Full-width digits,
 * `×`, `÷` and full-width brackets are accepted; spaces and thousands separators ignored.
 */
export function evaluate(text: string): ExprResult {
  const source = text
    .replace(/[０-９．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[\s,，]/g, "");
  let index = 0;

  const peek = () => source[index];

  function number(): number | null {
    const match = /^\d+(?:\.\d*)?|^\.\d+/.exec(source.slice(index));
    if (!match) return null;
    index += match[0].length;
    return Number(match[0]);
  }

  function factor(): number | null {
    const char = peek();
    if (char === "-" || char === "+") {
      index += 1;
      const value = factor();
      return value === null ? null : char === "-" ? -value : value;
    }
    if (char === "(") {
      index += 1;
      const value = sum();
      if (value === null || peek() !== ")") return null;
      index += 1;
      return value;
    }
    return number();
  }

  function product(): number | null {
    let value = factor();
    while (value !== null && (peek() === "*" || peek() === "/")) {
      const op = peek();
      index += 1;
      const right = factor();
      if (right === null || (op === "/" && right === 0)) return null;
      value = op === "*" ? value * right : value / right;
    }
    return value;
  }

  function sum(): number | null {
    let value = product();
    while (value !== null && (peek() === "+" || peek() === "-")) {
      const op = peek();
      index += 1;
      const right = product();
      if (right === null) return null;
      value = op === "+" ? value + right : value - right;
    }
    return value;
  }

  if (source === "") return { ok: false };
  const value = sum();
  if (value === null || index !== source.length || !Number.isFinite(value)) return { ok: false };
  // Round the scaled value after removing float noise (1.005*100 = 100.49999...).
  const scaled = Number((Math.abs(value) * 100).toPrecision(15));
  const cents = Math.sign(value) * Math.round(scaled);
  if (Math.abs(cents) >= MAX_CENTS) return { ok: false };
  return { ok: true, value: fromCents(cents === 0 ? 0 : cents) };
}
