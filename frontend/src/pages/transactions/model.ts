/** Pure logic of the transactions page: URL filter, paging, edit diffing. */

import type { Schemas } from "@/api/client";
import type { TransactionFilter } from "@/api/queries";
import { toCents } from "@/lib/money";
import { addMonths, isMonth, monthOf } from "@/lib/month";

export const PAGE_SIZE = 50;
/** How many months back the month filter offers, counting the current one. */
export const MONTH_OPTIONS = 24;

/**
 * The filter from the URL. Anything unreadable falls back to "not filtered" instead of
 * reaching the API: a malformed month, a category that is not in this account's tree
 * (checked once the tree is known), a page that is not a positive integer.
 */
export function readFilter(
  params: URLSearchParams,
  tree: Schemas["CategoryTree"] | undefined,
): TransactionFilter {
  const month = params.get("month");
  const category = Number(params.get("category"));
  const page = Number(params.get("page"));
  const known =
    tree === undefined ||
    tree.categories.some(
      (parent) => parent.id === category || parent.children.some((child) => child.id === category),
    );
  return {
    month: isMonth(month) ? month : null,
    categoryId: Number.isInteger(category) && category > 0 && known ? category : null,
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
  };
}

/** The current month and the ones before it, newest first; `selected` is kept if older. */
export function monthOptions(now: Date, selected: string | null): string[] {
  const current = monthOf(now);
  const months = Array.from({ length: MONTH_OPTIONS }, (_, index) => addMonths(current, -index));
  if (selected && !months.includes(selected)) months.push(selected);
  return months.sort().reverse();
}

/** The filter's category as level-1 and, for a level-2 one, its child. */
export function findCategory(
  tree: Schemas["CategoryTree"],
  id: number,
): { parent: Schemas["CategoryNode"]; child: Schemas["CategoryLeaf"] | null } | null {
  for (const parent of tree.categories) {
    if (parent.id === id) return { parent, child: null };
    const child = parent.children.find((candidate) => candidate.id === id);
    if (child) return { parent, child };
  }
  return null;
}

/** 1-based positions of the page's first and last rows, and the number of pages. */
export function pageRange(page: number, pageSize: number, total: number) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return { from, to, pages };
}

/** A refund is stored as a negative amount in the original expense's category. */
export function isRefund(amount: string): boolean {
  return toCents(amount) < 0;
}

/**
 * The PATCH body for an edit, holding only what changed, or null when nothing did.
 * The note is trimmed; an empty note is sent as `null`, which removes it.
 */
export function transactionChanges(
  original: Pick<Schemas["TransactionOut"], "category_id" | "note">,
  form: { categoryId: number; note: string },
): Schemas["TransactionUpdateIn"] | null {
  const changes: Schemas["TransactionUpdateIn"] = {};
  if (form.categoryId !== original.category_id) changes.category_id = form.categoryId;
  const note = form.note.trim() === "" ? null : form.note.trim();
  if (note !== (original.note ?? null)) changes.note = note;
  return Object.keys(changes).length > 0 ? changes : null;
}
