import { describe, expect, it } from "vitest";

import type { Schemas } from "@/api/client";

import { activeFirst, categoryChanges, categoryFields, hermesConfig, mcpEndpoint } from "./model";

describe("categoryFields / categoryChanges", () => {
  it("trims, keeps inner newlines and stores a blank description as null", () => {
    expect(categoryFields(" 超市 ", "  线下商超\n不含外卖 ")).toEqual({
      name: "超市",
      description: "线下商超\n不含外卖",
    });
    expect(categoryFields("超市", "   ")).toEqual({ name: "超市", description: null });
  });

  it("returns only what changed, or null", () => {
    const initial = { name: "超市", description: "线下商超" };
    expect(categoryChanges(initial, { name: "超市", description: "线下商超" })).toBeNull();
    expect(categoryChanges(initial, { name: "商超", description: "线下商超" })).toEqual({ name: "商超" });
    expect(categoryChanges(initial, { name: "超市", description: null })).toEqual({ description: null });
    expect(categoryChanges({ name: "超市", description: null }, categoryFields("超市", " "))).toBeNull();
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
