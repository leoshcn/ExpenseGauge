import { describe, expect, it } from "vitest";

import type { ClientRect } from "@dnd-kit/core";

import type { Schemas } from "@/api/client";

import {
  activeFirst,
  budgetReset,
  categoryChanges,
  categoryCreateBody,
  categoryFields,
  hermesConfig,
  leadingEdgeCollision,
  leafCounts,
  mcpEndpoint,
  movedOrder,
  periodOf,
  reorderTree,
} from "./model";

describe("categoryFields / categoryChanges", () => {
  it("trims, keeps inner newlines and stores a blank description as null", () => {
    expect(categoryFields(" 超市 ", "  线下商超\n不含外卖 ", 1)).toEqual({
      name: "超市",
      description: "线下商超\n不含外卖",
      budgetAccountId: 1,
      rolloverFrom: null,
    });
    expect(categoryFields("超市", "   ", 2)).toEqual({ name: "超市", description: null, budgetAccountId: 2, rolloverFrom: null });
  });

  it("returns only what changed as the PATCH body, or null", () => {
    const initial = { name: "超市", description: "线下商超", budgetAccountId: 1, rolloverFrom: null };
    expect(categoryChanges(initial, { ...initial })).toBeNull();
    expect(categoryChanges(initial, { ...initial, name: "商超" })).toEqual({ name: "商超" });
    expect(categoryChanges(initial, { ...initial, description: null })).toEqual({ description: null });
    expect(categoryChanges(initial, { ...initial, budgetAccountId: 2 })).toEqual({ budget_account_id: 2 });
    expect(categoryChanges(initial, { ...initial, rolloverFrom: "2026-10" })).toEqual({ rollover_from: "2026-10" });
    expect(categoryChanges({ ...initial, rolloverFrom: "2026-08" }, initial)).toEqual({ rollover_from: null });
    expect(
      categoryChanges(
        { name: "超市", description: null, budgetAccountId: 1, rolloverFrom: null },
        categoryFields("超市", " ", 1),
      ),
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
    const daily = { id: 1, name: "日常", period: "month" as const };
    const fixed = { id: 2, name: "固定", period: "month" as const };
    const leaf = (id: number, budget_account: typeof daily) => ({ id, name: `c${id}`, description: null, budget_account, rollover_from: null });
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

describe("reorderTree / movedOrder", () => {
  const daily = { id: 1, name: "日常", period: "month" as const };
  const leaf = (id: number) => ({ id, name: `c${id}`, description: null, budget_account: daily, rollover_from: null });
  const tree: Schemas["CategoryTree"] = {
    budget_account_id: null,
    categories: [
      { id: 10, name: "餐饮", children: [leaf(11), leaf(12), leaf(13)] },
      { id: 20, name: "交通", children: [leaf(21), leaf(22)] },
      { id: 30, name: "空的", children: [] },
    ],
  };
  const shape = (of: Schemas["CategoryTree"]) => of.categories.map((p) => [p.id, p.children.map((c) => c.id)]);

  it("reorders level 1 and takes each one's children along", () => {
    const next = reorderTree(tree, null, [30, 10, 20]);
    expect(shape(next)).toEqual([
      [30, []],
      [10, [11, 12, 13]],
      [20, [21, 22]],
    ]);
    expect(next.categories[1]).toBe(tree.categories[0]);
    expect(next.budget_account_id).toBeNull();
  });

  it("reorders the children of one level-1 category and leaves the others alone", () => {
    const next = reorderTree(tree, 10, [13, 11, 12]);
    expect(shape(next)).toEqual([
      [10, [13, 11, 12]],
      [20, [21, 22]],
      [30, []],
    ]);
    expect(next.categories[1]).toBe(tree.categories[1]);
    expect(next.categories[0]?.children[0]).toBe(tree.categories[0]?.children[2]);
  });

  it("does not change its input, and ignores ids that are not in the group", () => {
    const before = JSON.stringify(tree);
    // 21 belongs to another parent; 12 is not listed and stays after the listed ones.
    expect(shape(reorderTree(tree, 10, [13, 21, 11]))[0]).toEqual([10, [13, 11, 12]]);
    expect(shape(reorderTree(tree, 99, [13, 11]))).toEqual(shape(tree));
    expect(JSON.stringify(tree)).toBe(before);
  });

  it("moves the dropped id to the place of the one it was dropped on", () => {
    expect(movedOrder([1, 2, 3, 4], 1, 3)).toEqual([2, 3, 1, 4]);
    expect(movedOrder([1, 2, 3, 4], 4, 1)).toEqual([4, 1, 2, 3]);
    expect(movedOrder([1, 2], 2, 1)).toEqual([2, 1]);
  });

  it("is null when nothing moves", () => {
    expect(movedOrder([1, 2, 3], 2, 2)).toBeNull();
    expect(movedOrder([1, 2, 3], 2, undefined)).toBeNull(); // dropped outside the list
    expect(movedOrder([1, 2, 3], 9, 1)).toBeNull();
    expect(movedOrder([1, 2, 3], 1, 9)).toBeNull(); // a row of another list
    expect(movedOrder([1, 2, 3], "1", 2)).toBeNull();
  });
});

describe("leadingEdgeCollision", () => {
  // A tall level-1 block (300px) above two short ones (80px each).
  const rects = new Map<number, ClientRect>([
    [1, rect(0, 300)],
    [2, rect(300, 80)],
    [3, rect(380, 80)],
  ]);
  function rect(top: number, height: number): ClientRect {
    return { top, height, left: 0, width: 300, bottom: top + height, right: 300 };
  }
  const over = (activeId: number, top: number) => {
    const start = rects.get(activeId)!;
    const collisions = leadingEdgeCollision({
      active: { id: activeId },
      collisionRect: rect(top, start.height),
      droppableRects: rects,
      droppableContainers: [...rects.keys()].map((id) => ({ id })),
      pointerCoordinates: null,
    } as unknown as Parameters<typeof leadingEdgeCollision>[0]);
    return collisions.map((collision) => collision.id);
  };

  it("stays on itself until the leading edge passes the middle of a neighbour", () => {
    expect(over(1, 0)).toEqual([1]);
    expect(over(1, 39)).toEqual([1]); // bottom at 339, the middle of 2 is 340
    expect(over(2, 300)).toEqual([2]);
  });

  it("lets a tall block swap with a short one below although their centres never meet", () => {
    expect(over(1, 41)).toEqual([2]);
    expect(over(1, 80)).toEqual([2]); // bottom at 380: the farthest the list lets it go past 2
    expect(over(1, 121)).toEqual([3]);
  });

  it("uses the top edge when moving up, and picks the farthest row passed", () => {
    expect(over(3, 345)).toEqual([3]);
    expect(over(3, 339)).toEqual([2]);
    expect(over(3, 149)).toEqual([1]);
    expect(over(2, 149)).toEqual([1]);
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

describe("budgetReset / periodOf", () => {
  it("needs an amount or an explicit 无预算", () => {
    expect(budgetReset("", false)).toEqual({ valid: false, reason: "required" });
    expect(budgetReset("-1", false)).toEqual({ valid: false, reason: "invalid" });
    expect(budgetReset("12,000", false)).toEqual({ valid: true, amount: "12000.00" });
    expect(budgetReset("0", false)).toEqual({ valid: true, amount: "0.00" });
    expect(budgetReset("abc", true)).toEqual({ valid: true, amount: null });
  });

  it("finds a budget account's period", () => {
    const accounts: Schemas["BudgetAccountOut"][] = [
      { id: 1, name: "日常", period: "month" },
      { id: 3, name: "年度", period: "year" },
    ];
    expect(periodOf(accounts, 3)).toBe("year");
    expect(periodOf(accounts, 9)).toBeUndefined();
  });
});
