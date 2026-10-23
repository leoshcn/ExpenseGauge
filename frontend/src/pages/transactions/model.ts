/** Pure logic of the transactions page: URL filter, paging, edit diffing. */

import type { Schemas } from "@/api/client";
import type { TransactionFilter } from "@/api/queries";
import { fromCents, subtract, toCents } from "@/lib/money";
import { addMonths, isMonth, monthOf } from "@/lib/month";
import { isValidTag } from "@/lib/tags";

export const PAGE_SIZE = 50;
/** The API's limit for `q`. */
export const MAX_SEARCH = 100;
/** How many months back the month filter offers, counting the current one. */
export const MONTH_OPTIONS = 24;

/** The lists a URL filter is checked against; `undefined` while that list is loading. */
export type FilterLists = {
  tree: Schemas["CategoryTree"] | undefined;
  channels: readonly Schemas["ChannelOut"][] | undefined;
  budgetAccounts: readonly Schemas["BudgetAccountOut"][] | undefined;
};

/** A positive integer id from the URL that is in `ids` (or not yet checkable), else null. */
function knownId(raw: string | null, ids: readonly number[] | undefined): number | null {
  const id = Number(raw);
  if (raw === null || !Number.isInteger(id) || id <= 0) return null;
  return ids === undefined || ids.includes(id) ? id : null;
}

/**
 * The filter from the URL. Anything unreadable falls back to "not filtered" instead of
 * reaching the API: a malformed month, a channel, budget account or category that does
 * not exist (checked once its list is known), a page that is not a positive integer.
 */
export function readFilter(params: URLSearchParams, lists: FilterLists): TransactionFilter {
  const month = params.get("month");
  const page = Number(params.get("page"));
  const categoryIds = lists.tree?.categories.flatMap((parent) => [
    parent.id,
    ...parent.children.map((child) => child.id),
  ]);
  return {
    month: isMonth(month) ? month : null,
    channelId: knownId(params.get("channel"), lists.channels?.map((channel) => channel.id)),
    budgetAccountId: knownId(
      params.get("budget_account"),
      lists.budgetAccounts?.map((account) => account.id),
    ),
    categoryId: knownId(params.get("category"), categoryIds),
    refundStatus: params.get("refund") === "unmatched" ? "unmatched" : null,
    q: searchText(params.get("q")),
    amountMin: moneyParam(params.get("min")),
    amountMax: moneyParam(params.get("max")),
    dateFrom: dayParam(params.get("from")),
    dateTo: dayParam(params.get("to")),
    tags: [...new Set(params.getAll("tag").filter(isValidTag))],
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZE,
  };
}

/** Whether the URL names an id that cannot be checked yet because its list is loading. */
export function awaitsLists(params: URLSearchParams, lists: FilterLists): boolean {
  return (
    (params.has("channel") && lists.channels === undefined) ||
    (params.has("budget_account") && lists.budgetAccounts === undefined) ||
    (params.has("category") && lists.tree === undefined)
  );
}

/** The URL parameters of every filter, for "清除筛选" (`null` removes each). */
export const FILTER_PARAMS = [
  "month",
  "channel",
  "budget_account",
  "category",
  "refund",
  "q",
  "min",
  "max",
  "from",
  "to",
  "tag",
  "page",
] as const;

/** Whether any filter (not the page) is in effect. */
export function isFiltered(filter: TransactionFilter): boolean {
  return (
    filter.month !== null ||
    filter.channelId !== null ||
    filter.budgetAccountId !== null ||
    filter.categoryId !== null ||
    filter.refundStatus !== null ||
    filter.q !== null ||
    filter.amountMin !== null ||
    filter.amountMax !== null ||
    filter.dateFrom !== null ||
    filter.dateTo !== null ||
    filter.tags.length > 0
  );
}

/** Search text from the URL: trimmed, at most `MAX_SEARCH` characters, or null. */
export function searchText(raw: string | null): string | null {
  const text = raw?.trim() ?? "";
  return text === "" ? null : [...text].slice(0, MAX_SEARCH).join("");
}

const MONEY = /^\d{1,12}(?:\.\d{1,2})?$/;

/** A non-negative amount from the URL as a money string ("50" -> "50.00"), or null. */
export function moneyParam(raw: string | null): string | null {
  if (raw === null || !MONEY.test(raw)) return null;
  return fromCents(toCents(raw));
}

/** A real calendar day `YYYY-MM-DD` from the URL, or null. */
export function dayParam(raw: string | null): string | null {
  if (raw === null || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [year, month, day] = raw.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? raw
    : null;
}

/** The rows of a page grouped by their own date, newest first, with each day's net. */
export function groupByDay(items: readonly Schemas["TransactionOut"][]) {
  const groups: { date: string; net: string; items: Schemas["TransactionOut"][] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.date) {
      last.items.push(item);
      last.net = fromCents(toCents(last.net) + toCents(item.amount));
    } else {
      groups.push({ date: item.date, net: item.amount, items: [item] });
    }
  }
  return groups;
}

/** The net of the selected rows. */
export function sumAmounts(items: Iterable<Pick<Schemas["TransactionOut"], "amount">>): string {
  let cents = 0;
  for (const item of items) cents += toCents(item.amount);
  return fromCents(cents);
}

/**
 * The selected rows a batch category change applies to, and the matched refunds it must
 * skip (their category follows the payment).
 */
export function recategorizable(items: Iterable<Schemas["TransactionOut"]>) {
  const changed: Schemas["TransactionOut"][] = [];
  const skipped: Schemas["TransactionOut"][] = [];
  for (const item of items) (item.refund_of === null ? changed : skipped).push(item);
  return { changed, skipped };
}

/** The budget account a level-2 category belongs to, or null if it is not in the tree. */
export function budgetAccountOf(
  tree: Schemas["CategoryTree"],
  categoryId: number,
): Schemas["BudgetAccountOut"] | null {
  return findCategory(tree, categoryId)?.child?.budget_account ?? null;
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

/** A refund is stored as a negative amount; a payment as a positive one. */
export function isRefund(amount: string): boolean {
  return toCents(amount) < 0;
}

/** The payment a refund is matched to, as shown before saving. */
export type RefundTarget = Schemas["RefundTarget"];

/** The refund's matching state; null for a payment. */
export function matchState(transaction: Pick<Schemas["TransactionOut"], "amount" | "refund_of">) {
  if (!isRefund(transaction.amount)) return null;
  return transaction.refund_of === null ? "unmatched" : "matched";
}

/**
 * What a payment's refunds amount to: nothing (null) without matched refunds, else the
 * refunded total, the net amount left and whether it is fully refunded (net 0).
 */
export function paymentRefunds(transaction: Pick<Schemas["TransactionOut"], "amount" | "refunded">) {
  if (isRefund(transaction.amount) || toCents(transaction.refunded) === 0) return null;
  const net = subtract(transaction.amount, transaction.refunded);
  return { refunded: transaction.refunded, net, full: toCents(net) === 0 };
}

/** A candidate payment as the refund's `refund_of` will show it once matched. */
export function toRefundTarget(payment: Schemas["TransactionOut"]): RefundTarget {
  return {
    id: payment.id,
    date: payment.date,
    amount: payment.amount,
    counterparty: payment.counterparty,
    category_name: payment.category_name,
  };
}

/**
 * Whether the category select is editable. A matched refund's category follows its
 * payment; a refund whose match is being removed gets its own category back on save,
 * which this page does not know yet, so it is edited after saving.
 */
export function categoryEditable(
  original: Pick<Schemas["TransactionOut"], "refund_of">,
  refundOf: RefundTarget | null,
): boolean {
  return original.refund_of === null && refundOf === null;
}

/**
 * The PATCH body for an edit, holding only what changed, or null when nothing did.
 * The note is trimmed; an empty note is sent as `null`, which removes it. `refundOf` is
 * the refund's chosen payment (null: unmatched); the category is sent only while it is
 * editable, never together with a match.
 */
export function transactionChanges(
  original: Pick<Schemas["TransactionOut"], "category_id" | "note" | "refund_of">,
  form: { categoryId: number; note: string; refundOf: RefundTarget | null },
): Schemas["TransactionUpdateIn"] | null {
  const changes: Schemas["TransactionUpdateIn"] = {};
  const refundOfId = form.refundOf?.id ?? null;
  if (refundOfId !== (original.refund_of?.id ?? null)) changes.refund_of_id = refundOfId;
  if (categoryEditable(original, form.refundOf) && form.categoryId !== original.category_id) {
    changes.category_id = form.categoryId;
  }
  const note = form.note.trim() === "" ? null : form.note.trim();
  if (note !== (original.note ?? null)) changes.note = note;
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * The PATCH body that puts back what `changes` (an edit's body) changed: the original
 * category, note and original payment of each field it touched.
 */
export function reverseChanges(
  original: Pick<Schemas["TransactionOut"], "category_id" | "note" | "refund_of">,
  changes: Schemas["TransactionUpdateIn"],
): Schemas["TransactionUpdateIn"] {
  const reverse: Schemas["TransactionUpdateIn"] = {};
  if ("refund_of_id" in changes) reverse.refund_of_id = original.refund_of?.id ?? null;
  if ("category_id" in changes) reverse.category_id = original.category_id;
  if ("note" in changes) reverse.note = original.note;
  return reverse;
}
