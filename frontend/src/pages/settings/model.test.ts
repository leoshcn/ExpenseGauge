import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import {
  activeFirst,
  categoryChanges,
  categoryCreateBody,
  categoryFields,
  hermesConfig,
  leafCounts,
  mcpEndpoint,
} from "./model";

describe("categoryFields / categoryChanges", () => {
  it("trims, keeps inner newlines and stores a blank description as null", () => {
    expect(categoryFields(" 超市 ", "  线下商超\n不含外卖 ", 1)).toEqual({
      name: "超市",
      description: "线下商超\n不含外卖",
      budgetAccountId: 1,
    });
    expect(categoryFields("超市", "   ", 2)).toEqual({ name: "超市", description: null, budgetAccountId: 2 });
  });

  it("returns only what changed as the PATCH body, or null", () => {
    const initial = { name: "超市", description: "线下商超", budgetAccountId: 1 };
    expect(categoryChanges(initial, { ...initial })).toBeNull();
    expect(categoryChanges(initial, { ...initial, name: "商超" })).toEqual({ name: "商超" });
    expect(categoryChanges(initial, { ...initial, description: null })).toEqual({ description: null });
    expect(categoryChanges(initial, { ...initial, budgetAccountId: 2 })).toEqual({ budget_account_id: 2 });
    expect(
      categoryChanges({ name: "超市", description: null, budgetAccountId: 1 }, categoryFields("超市", " ", 1)),
    ).toBeNull();
  });

  it("creates a level-2 category with its parent and budget account", () => {
    expect(categoryCreateBody(10, categoryFields("零食", "", 2))).toEqual({
      name: "零食",
      description: null,
      parent_id: 10,
      budget_account_id: 2,
    });
  });
});

describe("leafCounts", () => {
  it("counts level-2 categories per budget account across level-1 categories", () => {
    const daily = { id: 1, name: "日常" };
    const fixed = { id: 2, name: "固定" };
    const leaf = (id: number, budget_account: typeof daily) => ({ id, name: `c${id}`, description: null, budget_account });
    const counts = leafCounts({
      budget_account_id: null,
      categories: [
        { id: 1, name: "居住", children: [leaf(11, fixed), leaf(12, daily)] },
        { id: 2, name: "餐饮", children: [leaf(21, daily)] },
        { id: 3, name: "空的", children: [] },
      ],
    });
    expect(Object.fromEntries(counts)).toEqual({ 1: 2, 2: 1 });
  });
});

const token = (id: number, revoked_at: string | null = null): Schemas["TokenOut"] => ({
  id,
  name: `t${id}`,
  created_at: "2026-10-01T00:00:00Z",
  last_used_at: null,
  revoked_at,
});

describe("mcpEndpoint", () => {
  it("is /mcp on the app's own origin", () => {
    expect(mcpEndpoint("http://192.168.1.5:8080")).toBe("http://192.168.1.5:8080/mcp");
    expect(mcpEndpoint("http://localhost:5173/")).toBe("http://localhost:5173/mcp");
  });
});

describe("hermesConfig", () => {
  it("is the YAML entry Hermes Agent reads", () => {
    expect(hermesConfig("http://h/mcp", "<令牌>")).toBe(
      "mcp_servers:\n  expensegauge:\n    url: http://h/mcp\n    headers:\n      Authorization: Bearer <令牌>",
    );
  });
});

describe("activeFirst", () => {
  it("lists usable tokens newest first, then revoked ones", () => {
    const list = [
      token(1),
      token(2, "2026-10-02T00:00:00Z"),
      token(3),
      token(4, "2026-10-05T00:00:00Z"),
    ];
    expect(activeFirst(list).map((t) => t.id)).toEqual([3, 1, 4, 2]);
  });
});
