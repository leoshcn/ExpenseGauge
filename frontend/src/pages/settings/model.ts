/** Pure helpers of the settings page. */

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

/** Usable tokens first, newest first; revoked ones after them, most recently revoked first. */
export function activeFirst(tokens: readonly Schemas["TokenOut"][]): Schemas["TokenOut"][] {
  return [...tokens].sort((a, b) => {
    if ((a.revoked_at === null) !== (b.revoked_at === null)) return a.revoked_at === null ? -1 : 1;
    if (a.revoked_at !== null && b.revoked_at !== null) return b.revoked_at.localeCompare(a.revoked_at);
    return b.id - a.id;
  });
}
