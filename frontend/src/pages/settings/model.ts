/** Pure helpers of the settings page. */

import type { CollisionDetection } from "@dnd-kit/core";

import type { Schemas } from "@/api/client";
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

/** A level-2 category's editable fields as the API stores them. */
export type CategoryFields = { name: string; description: string | null; budgetAccountId: number };

/** The form's values as the API stores them: trimmed, a blank description as `null`. */
export function categoryFields(name: string, description: string, budgetAccountId: number): CategoryFields {
  return { name: name.trim(), description: description.trim() || null, budgetAccountId };
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
