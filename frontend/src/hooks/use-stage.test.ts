import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";

import { missingStep, resolveStage, type StageInputs } from "./use-stage";

type Step<T> = { data: T | undefined; isLoadingError: boolean; error: unknown; refetch: () => unknown };

const loading = <T>(): Step<T> => ({
  data: undefined,
  isLoadingError: false,
  error: null,
  refetch: () => {},
});
const loaded = <T>(data: T): Step<T> => ({ ...loading<T>(), data });
const failed = <T>(error: unknown, refetch: () => unknown = () => {}): Step<T> => ({
  data: undefined,
  isLoadingError: true,
  error,
  refetch,
});

const user: Schemas["UserOut"] = { id: 1, username: "demo", created_at: "2026-10-10T00:00:00Z" };
const daily: Schemas["BudgetAccountOut"] = { id: 1, name: "日常", period: "month" };
const card: Schemas["ChannelOut"] = { id: 1, name: "储蓄卡" };
const tree = (children: number): Schemas["CategoryTree"] => ({
  budget_account_id: null,
  categories: [
    {
      id: 10,
      name: "餐饮",
      children: Array.from({ length: children }, (_, index) => ({
        id: index + 11,
        name: "买菜",
        description: null,
        budget_account: daily,
      })),
    },
  ],
});

function inputs(overrides: Partial<StageInputs> = {}): StageInputs {
  return {
    setup: loaded({ user_exists: true }),
    me: loaded<Schemas["UserOut"] | null>(user),
    settings: loaded({ currency: "CNY" }),
    budgetAccounts: loaded([daily]),
    tree: loaded(tree(1)),
    channels: loaded([card]),
    ...overrides,
  };
}

const onboarding = { status: "ready", stage: "onboarding" };

describe("resolveStage", () => {
  it("walks setup -> login -> onboarding -> app", () => {
    expect(resolveStage(inputs({ setup: loaded({ user_exists: false }) }))).toEqual({
      status: "ready",
      stage: "setup",
    });
    expect(resolveStage(inputs({ me: loaded(null) }))).toEqual({ status: "ready", stage: "login" });
    expect(resolveStage(inputs({ budgetAccounts: loaded([]) }))).toEqual(onboarding);
    expect(resolveStage(inputs())).toEqual({ status: "ready", stage: "app" });
  });

  it("stays in onboarding until currency, budget account, usable category and channel exist", () => {
    expect(resolveStage(inputs({ settings: loaded({ currency: null }) }))).toEqual(onboarding);
    expect(resolveStage(inputs({ tree: loaded(tree(0)) }))).toEqual(onboarding);
    expect(resolveStage(inputs({ channels: loaded([]) }))).toEqual(onboarding);
  });

  it("decides onboarding from an earlier step while a later one is still loading", () => {
    expect(resolveStage(inputs({ budgetAccounts: loaded([]), tree: loading(), channels: loading() }))).toEqual(
      onboarding,
    );
    expect(resolveStage(inputs({ tree: loaded(tree(0)), channels: failed("boom") }))).toEqual(onboarding);
  });

  it("is loading while the deciding step has no answer yet", () => {
    expect(resolveStage(inputs({ setup: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ me: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ settings: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ budgetAccounts: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ tree: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ channels: loading() }))).toEqual({ status: "loading" });
  });

  it("sends an ended session to login even if a later query failed on its first load", () => {
    // `me` went null on a 401 while `settings` was still failing from the same 401.
    const state = resolveStage(inputs({ me: loaded(null), settings: failed("401"), channels: failed("401") }));
    expect(state).toEqual({ status: "ready", stage: "login" });
  });

  it("reports the failing step and retries that step", () => {
    const refetch = vi.fn();
    const state = resolveStage(inputs({ setup: failed("down", refetch) }));
    expect(state).toMatchObject({ status: "error", error: "down" });
    if (state.status === "error") state.retry();
    expect(refetch).toHaveBeenCalledOnce();

    expect(resolveStage(inputs({ me: failed("500") }))).toMatchObject({ status: "error", error: "500" });
    expect(resolveStage(inputs({ settings: failed("500") }))).toMatchObject({ status: "error", error: "500" });
    expect(resolveStage(inputs({ tree: failed("500") }))).toMatchObject({ status: "error", error: "500" });
    expect(resolveStage(inputs({ channels: failed("500") }))).toMatchObject({ status: "error", error: "500" });
  });
});

describe("missingStep", () => {
  it("names the first missing piece, or null when the ledger is ready", () => {
    expect(missingStep({ currency: null }, [daily], tree(1), [card])).toBe(1);
    expect(missingStep({ currency: "CNY" }, [], tree(1), [card])).toBe(1);
    expect(missingStep({ currency: "CNY" }, [daily], tree(0), [card])).toBe(2);
    expect(missingStep({ currency: "CNY" }, [daily], tree(1), [])).toBe(3);
    expect(missingStep({ currency: "CNY" }, [daily], tree(1), [card])).toBeNull();
  });
});
