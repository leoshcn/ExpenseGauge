/** Pure helpers of the settings page. */

import type { Schemas } from "@/api/client";

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
export type CategoryFields = { name: string; description: string | null };

/** The form's raw text as the API stores it: trimmed, a blank description as `null`. */
export function categoryFields(name: string, description: string): CategoryFields {
  return { name: name.trim(), description: description.trim() || null };
}

/** The fields of `next` that differ from `initial`, or `null` when nothing changed. */
export function categoryChanges(
  initial: CategoryFields,
  next: CategoryFields,
): Partial<CategoryFields> | null {
  const changes: Partial<CategoryFields> = {};
  if (next.name !== initial.name) changes.name = next.name;
  if (next.description !== initial.description) changes.description = next.description;
  return Object.keys(changes).length > 0 ? changes : null;
}

/** Usable tokens first, newest first; revoked ones after them, most recently revoked first. */
export function activeFirst(tokens: readonly Schemas["TokenOut"][]): Schemas["TokenOut"][] {
  return [...tokens].sort((a, b) => {
    if ((a.revoked_at === null) !== (b.revoked_at === null)) return a.revoked_at === null ? -1 : 1;
    if (a.revoked_at !== null && b.revoked_at !== null) return b.revoked_at.localeCompare(a.revoked_at);
    return b.id - a.id;
  });
}
