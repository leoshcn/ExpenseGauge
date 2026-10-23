/** Pure helpers of the settings page. */

import type { CollisionDetection } from "@dnd-kit/core";

import type { Schemas } from "@/api/client";
import { toCents } from "@/lib/money";
import { parseBudgetInput } from "@/pages/budgets/model";

/** Path of the MCP server, served by the same origin as the app (nginx, or the Vite proxy). */
export const MCP_PATH = "/mcp";

export function mcpEndpoint(origin: string): string {
  return `${origin.replace(/\/+$/, "")}${MCP_PATH}`;
}

/** The `~/.hermes/config.yaml` entry for this server (research/hermes-agent-mcp.md). */
export function hermesConfig(endpoint: string, token: string): string {
  return [
    "mcp_servers:",
    "  expensegauge:",
    `    url: ${endpoint}`,
    "    headers:",
    `      Authorization: Bearer ${token}`,
  ].join("\n");
}

/** Longest description of a level-2 category (`categories.description VARCHAR(500)`). */
export const CATEGORY_DESCRIPTION_MAX = 500;

/**
 * A level-2 category's editable fields as the API stores them. `rolloverFrom` is the
 * month its rollover starts (`YYYY-MM`), or null.
 */
export type CategoryFields = {
  name: string;
  description: string | null;
  budgetAccountId: number;
  rolloverFrom: string | null;
};

/** The form's values as the API stores them: trimmed, a blank description as `null`. */
export function categoryFields(
  name: string,
  description: string,
  budgetAccountId: number,
  rolloverFrom: string | null = null,
): CategoryFields {
  return { name: name.trim(), description: description.trim() || null, budgetAccountId, rolloverFrom };
}

/** The body that creates a level-2 category under `parentId`. */
export function categoryCreateBody(parentId: number, fields: CategoryFields): Schemas["CategoryCreateIn"] {
  return {
    name: fields.name,
    description: fields.description,
    parent_id: parentId,
    budget_account_id: fields.budgetAccountId,
  };
}

/** The PATCH body with the fields of `next` that differ from `initial`, or `null` when nothing changed. */
export function categoryChanges(
  initial: CategoryFields,
  next: CategoryFields,
): Schemas["CategoryUpdateIn"] | null {
  const changes: Schemas["CategoryUpdateIn"] = {};
  if (next.name !== initial.name) changes.name = next.name;
  if (next.description !== initial.description) changes.description = next.description;
  if (next.budgetAccountId !== initial.budgetAccountId) changes.budget_account_id = next.budgetAccountId;
  if (next.rolloverFrom !== initial.rolloverFrom) changes.rollover_from = next.rolloverFrom;
  return Object.keys(changes).length > 0 ? changes : null;
}

export type BudgetPeriod = Schemas["BudgetAccountOut"]["period"];

/** The period of a budget account, or undefined when it is not in the list. */
export function periodOf(
  budgetAccounts: readonly Schemas["BudgetAccountOut"][],
  id: number,
): BudgetPeriod | undefined {
  return budgetAccounts.find((account) => account.id === id)?.period;
}

export type BudgetReset = { valid: true; amount: string | null } | { valid: false; reason: "required" | "invalid" };

/**
 * The `budget_amount` of a move to a budget account of the other period: the typed amount,
 * or `null` when "no budget" is chosen explicitly. An empty input is not "no budget" here
 * (the API requires a decision), and `"0"` is a budget of zero.
 */
export function budgetReset(text: string, none: boolean): BudgetReset {
  if (none) return { valid: true, amount: null };
  const parsed = parseBudgetInput(text);
  if (!parsed.valid) return { valid: false, reason: "invalid" };
  if (parsed.amount === null) return { valid: false, reason: "required" };
  return { valid: true, amount: parsed.amount };
}

/** How many level-2 categories each budget account has, by budget account id. */
export function leafCounts(tree: Schemas["CategoryTree"]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const parent of tree.categories) {
    for (const child of parent.children) {
      counts.set(child.budget_account.id, (counts.get(child.budget_account.id) ?? 0) + 1);
    }
  }
  return counts;
}

function inOrder<T extends { id: number }>(items: readonly T[], orderedIds: readonly number[]): T[] {
  const rank = new Map(orderedIds.map((id, index) => [id, index]));
  const of = (item: T) => rank.get(item.id) ?? orderedIds.length;
  return [...items].sort((a, b) => of(a) - of(b));
}

/**
 * The tree with one sibling group in the order of `orderedIds`: level 1 when `parentId` is
 * null, else that level-1 category's children. Every other group is untouched; a category
 * of the group that is not listed keeps its place after the listed ones.
 */
export function reorderTree(
  tree: Schemas["CategoryTree"],
  parentId: number | null,
  orderedIds: readonly number[],
): Schemas["CategoryTree"] {
  if (parentId === null) return { ...tree, categories: inOrder(tree.categories, orderedIds) };
  return {
    ...tree,
    categories: tree.categories.map((parent) =>
      parent.id === parentId ? { ...parent, children: inOrder(parent.children, orderedIds) } : parent,
    ),
  };
}

/**
 * `ids` after the item `activeId` is dropped on the place of `overId`, or `null` when
 * nothing moves (dropped on itself, outside the list, or an id the list does not have).
 */
export function movedOrder(
  ids: readonly number[],
  activeId: number | string,
  overId: number | string | undefined,
): number[] | null {
  const from = ids.findIndex((id) => id === activeId);
  const to = ids.findIndex((id) => id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const next = [...ids];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * Which row a dragged row is over, for rows of different heights (a level-1 row is as tall
 * as its children): the farthest row whose middle the leading edge has passed, the bottom
 * edge when moving down and the top edge when moving up. Comparing centres, as dnd-kit's
 * `closestCenter` does, never lets a tall block swap with a short neighbour, because the
 * list bounds stop the block before the two centres meet.
 */
export const leadingEdgeCollision: CollisionDetection = ({
  active,
  collisionRect,
  droppableRects,
  droppableContainers,
}) => {
  const start = droppableRects.get(active.id);
  if (!start) return [];
  const down = collisionRect.top > start.top;
  const edge = down ? collisionRect.top + collisionRect.height : collisionRect.top;
  let over = active.id;
  let farthest = start.top;
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id);
    if (!rect || container.id === active.id) continue;
    const middle = rect.top + rect.height / 2;
    const passed = down ? rect.top > farthest && middle < edge : rect.top < farthest && middle > edge;
    if (passed) {
      over = container.id;
      farthest = rect.top;
    }
  }
  return [{ id: over }];
};

/** Usable tokens first, newest first; revoked ones after them, most recently revoked first. */
export function activeFirst(tokens: readonly Schemas["TokenOut"][]): Schemas["TokenOut"][] {
  return [...tokens].sort((a, b) => {
    if ((a.revoked_at === null) !== (b.revoked_at === null)) return a.revoked_at === null ? -1 : 1;
    if (a.revoked_at !== null && b.revoked_at !== null) return b.revoked_at.localeCompare(a.revoked_at);
    return b.id - a.id;
  });
}

/** What the AI settings form holds: the key field is only what the user typed now. */
export type AiForm = { baseUrl: string; model: string; apiKey: string; clearKey: boolean };

export type AiFormErrors = { baseUrl?: "required" | "invalid"; model?: "required"; apiKey?: "invalid" };

export function validateAiForm(form: AiForm): AiFormErrors {
  const baseUrl = form.baseUrl.trim();
  const errors: AiFormErrors = {};
  if (!baseUrl) errors.baseUrl = "required";
  else if (!/^https?:\/\/[^/\s]+/i.test(baseUrl)) errors.baseUrl = "invalid";
  if (!form.model.trim()) errors.model = "required";
  // The key is sent in an HTTP header: printable ASCII only, no inner spaces.
  const key = form.apiKey.trim();
  if (!form.clearKey && key && !/^[\x21-\x7e]+$/.test(key)) errors.apiKey = "invalid";
  return errors;
}

/**
 * The PUT body. `api_key` is sent only when the user typed a new key (replace) or pressed
 * 清除 (`null`); left out, the server keeps the stored key.
 */
export function aiSettingsBody(form: AiForm): Schemas["AiSettingsUpdateIn"] {
  const body: Schemas["AiSettingsUpdateIn"] = { base_url: form.baseUrl.trim(), model: form.model.trim() };
  const key = form.apiKey.trim();
  if (form.clearKey) body.api_key = null;
  else if (key) body.api_key = key;
  return body;
}

/** The schedule dialog's fields, as typed. */
export type ScheduleForm = {
  name: string;
  keyword: string;
  categoryId: number | null;
  amount: string;
  approximate: boolean;
  frequency: Schemas["ScheduleCreateIn"]["frequency"] & string;
  /** 1-31, or -1 for the last day. */
  day: number;
  monthOfYear: number;
  startMonth: string;
  active: boolean;
};

export type ScheduleFormErrors = Partial<Record<"name" | "keyword" | "category" | "amount", true>>;

/** The form for an existing schedule, or a new one starting `month`. */
export function scheduleForm(month: string, schedule?: Schemas["ScheduleOut"]): ScheduleForm {
  return {
    name: schedule?.name ?? "",
    keyword: schedule?.keyword ?? "",
    categoryId: schedule?.category_id ?? null,
    amount: schedule?.amount ?? "",
    approximate: schedule?.approximate ?? false,
    frequency: schedule?.frequency ?? "month",
    day: schedule?.day ?? 1,
    monthOfYear: schedule?.month_of_year ?? 1,
    startMonth: schedule?.start_month ?? month,
    active: schedule?.active ?? true,
  };
}

/**
 * The create body for the form, or what is missing. The amount may be a calculation
 * (`parseBudgetInput`) and must be above zero; `month_of_year` only for a yearly schedule.
 */
export function scheduleBody(
  form: ScheduleForm,
): { valid: true; body: Schemas["ScheduleCreateIn"] } | { valid: false; errors: ScheduleFormErrors } {
  const errors: ScheduleFormErrors = {};
  const amount = parseBudgetInput(form.amount);
  if (form.name.trim() === "") errors.name = true;
  if (form.keyword.trim() === "") errors.keyword = true;
  if (form.categoryId === null) errors.category = true;
  if (!amount.valid || amount.amount === null || toCents(amount.amount) <= 0) errors.amount = true;
  if (Object.keys(errors).length > 0 || form.categoryId === null || !amount.valid || amount.amount === null) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    body: {
      name: form.name.trim(),
      keyword: form.keyword.trim(),
      category_id: form.categoryId,
      amount: amount.amount,
      approximate: form.approximate,
      frequency: form.frequency,
      day: form.day,
      month_of_year: form.frequency === "year" ? form.monthOfYear : null,
      start_month: form.startMonth,
      active: form.active,
    },
  };
}

/** The PATCH body with what differs from the stored schedule, or null. */
export function scheduleChanges(
  initial: Schemas["ScheduleOut"],
  body: Schemas["ScheduleCreateIn"],
): Schemas["ScheduleUpdateIn"] | null {
  const changes: Schemas["ScheduleUpdateIn"] = {};
  if (body.name !== initial.name) changes.name = body.name;
  if (body.keyword !== initial.keyword) changes.keyword = body.keyword;
  if (body.category_id !== initial.category_id) changes.category_id = body.category_id;
  if (toCents(String(body.amount)) !== toCents(initial.amount)) changes.amount = body.amount;
  if (body.approximate !== initial.approximate) changes.approximate = body.approximate;
  if (body.frequency !== initial.frequency) changes.frequency = body.frequency;
  if (body.day !== initial.day) changes.day = body.day;
  if ((body.month_of_year ?? null) !== initial.month_of_year) changes.month_of_year = body.month_of_year ?? null;
  if (body.start_month && body.start_month !== initial.start_month) changes.start_month = body.start_month;
  if (body.active !== undefined && body.active !== initial.active) changes.active = body.active;
  return Object.keys(changes).length > 0 ? changes : null;
}
