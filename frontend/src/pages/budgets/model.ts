/**
 * Pure logic of the budget page. A budget is `string | null` throughout: `null` is
 * "no budget" (never set, or cleared), "0.00" is a budget of zero. In the form an empty
 * input stands for `null`, so clearing an input clears the budget.
 */

import type { Schemas } from "@/api/client";
import { evaluate, isExpression } from "@/lib/expr";
import { fromCents, toCents } from "@/lib/money";

/** Input texts the user has typed, by level-2 category id. Untouched rows are absent. */
export type BudgetDraft = Readonly<Record<number, string>>;

export type ParsedAmount = { valid: true; amount: string | null } | { valid: false };

/** NUMERIC(14,2): at most 12 digits before the point. */
const AMOUNT = /^(\d{1,12})(?:\.(\d{0,2}))?$/;

/**
 * "" -> no budget (null); "1,200.5" -> "1200.50"; "0" -> "0.00"; "1800*1.1" -> "1980.00".
 * Spaces and thousands separators are ignored, full-width digits and point are accepted.
 * A calculation (`lib/expr.ts`) is evaluated and rounded to cents. Negative amounts,
 * more than two decimals, malformed calculations and anything else are invalid.
 */
export function parseBudgetInput(text: string): ParsedAmount {
  const cleaned = text
    .replace(/[０-９．]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[\s,，]/g, "");
  if (cleaned === "") return { valid: true, amount: null };
  if (isExpression(cleaned)) {
    const result = evaluate(cleaned);
    return result.ok && toCents(result.value) >= 0 && AMOUNT.test(result.value)
      ? { valid: true, amount: result.value }
      : { valid: false };
  }
  const match = AMOUNT.exec(cleaned);
  if (!match) return { valid: false };
  const [, whole = "0", fraction = ""] = match;
  return { valid: true, amount: fromCents(toCents(`${whole}.${fraction.padEnd(2, "0")}`)) };
}

/** Same budget, comparing amounts by value ("500" and "500.00") and null only to null. */
export function sameBudget(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return toCents(a) === toCents(b);
}

/** The input's text for a row: what the user typed, or else the amount in force. */
export function inputText(line: Pick<Schemas["BudgetLine"], "category_id" | "amount">, draft: BudgetDraft): string {
  return draft[line.category_id] ?? line.amount ?? "";
}

export type RowState = {
  /** The amount the row would be saved with, when the text is valid. */
  parsed: ParsedAmount;
  /** Differs from the amount in force for the chosen month. */
  changed: boolean;
};

export function rowState(line: Schemas["BudgetLine"], draft: BudgetDraft): RowState {
  const text = draft[line.category_id];
  if (text === undefined) return { parsed: { valid: true, amount: line.amount }, changed: false };
  const parsed = parseBudgetInput(text);
  return { parsed, changed: parsed.valid ? !sameBudget(parsed.amount, line.amount) : true };
}

/**
 * The PUT items for the chosen month: one per row whose valid amount differs from the
 * one in force, with `amount: null` to clear. Invalid rows are listed separately and
 * nothing should be sent while there are any.
 */
export function budgetChanges(
  lines: readonly Schemas["BudgetLine"][],
  draft: BudgetDraft,
): { items: Schemas["BudgetItemIn"][]; invalid: number[] } {
  const items: Schemas["BudgetItemIn"][] = [];
  const invalid: number[] = [];
  for (const line of lines) {
    const { parsed, changed } = rowState(line, draft);
    if (!parsed.valid) invalid.push(line.category_id);
    else if (changed) items.push({ category_id: line.category_id, amount: parsed.amount });
  }
  return { items, invalid };
}

/**
 * The draft once a save of `sent` succeeded: entries saved as typed are dropped, while
 * anything typed during the request (a different text, or a new row) is kept.
 */
export function draftAfterSave(current: BudgetDraft, sent: BudgetDraft): BudgetDraft {
  return Object.fromEntries(
    Object.entries(current).filter(([id, text]) => sent[Number(id)] !== text),
  ) as BudgetDraft;
}

/**
 * Sum of the amounts that are set; null when none is (a level-1 category whose children
 * have no budget has no budget either, as on the Dashboard). Invalid rows count as their
 * amount in force, so a typo does not make the subtotal jump.
 */
export function sumBudgets(amounts: readonly (string | null)[]): string | null {
  let total = 0;
  let any = false;
  for (const amount of amounts) {
    if (amount === null) continue;
    total += toCents(amount);
    any = true;
  }
  return any ? fromCents(total) : null;
}

/** The amount a row contributes to subtotals: the valid draft value, else the one in force. */
export function effectiveAmount(line: Schemas["BudgetLine"], draft: BudgetDraft): string | null {
  const { parsed } = rowState(line, draft);
  return parsed.valid ? parsed.amount : line.amount;
}

/**
 * Subtotals kept apart by period: a monthly and an annual amount cannot be added. Each is
 * `sumBudgets` of its lines; `undefined` when there are no lines of that period at all.
 */
export function sumByPeriod(
  lines: readonly Schemas["BudgetLine"][],
  draft: BudgetDraft,
): { month?: string | null; year?: string | null } {
  const sum = (period: Schemas["BudgetLine"]["period"]) => {
    const of = lines.filter((line) => line.period === period);
    return of.length === 0 ? undefined : sumBudgets(of.map((line) => effectiveAmount(line, draft)));
  };
  return { month: sum("month"), year: sum("year") };
}

export type BudgetGroup = {
  id: number;
  name: string;
  lines: Schemas["BudgetLine"][];
};

/**
 * Lines grouped under their level-1 category, in the category tree's order (the order
 * used everywhere else). Level-1 categories without children are kept with no lines,
 * so the page can say why they have nothing to set.
 */
export function groupLines(
  tree: Schemas["CategoryTree"],
  lines: readonly Schemas["BudgetLine"][],
): BudgetGroup[] {
  const byId = new Map(lines.map((line) => [line.category_id, line]));
  return tree.categories.map((parent) => ({
    id: parent.id,
    name: parent.name,
    lines: parent.children.flatMap((child) => {
      const line = byId.get(child.id);
      return line ? [line] : [];
    }),
  }));
}

/** Which reference a "fill all" uses: the 3-month average, or last month (last year). */
export type ReferenceKind = "avg3" | "last";

/** A money string rounded half up to whole units, as an input text: "96.67" -> "97". */
export function roundToUnit(amount: string): string {
  const cents = toCents(amount);
  return String(Math.round(Math.max(cents, 0) / 100));
}

/**
 * The draft after "fill all" with a reference: every line whose reference is above zero
 * gets it, rounded to whole units; others keep what they had. The 3-month average does not
 * exist for annual lines, which then keep theirs too.
 */
export function fillFromReference(
  lines: readonly Schemas["BudgetLine"][],
  draft: BudgetDraft,
  kind: ReferenceKind,
): BudgetDraft {
  const next: Record<number, string> = { ...draft };
  for (const line of lines) {
    const value = kind === "avg3" ? line.reference_avg3 : line.reference_last;
    if (value !== null && toCents(value) > 0) next[line.category_id] = roundToUnit(value);
  }
  return next;
}
