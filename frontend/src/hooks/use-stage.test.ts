import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";

import { resolveStage, type StageInputs } from "./use-stage";

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
const account = (id: number): Schemas["AccountOut"] => ({ id, name: `账户${id}`, currency: "CNY" });
const tree = (accountId: number, children: number): Schemas["CategoryTree"] => ({
  account_id: accountId,
  categories: [
    {
      id: accountId * 10,
      name: "餐饮",
      children: Array.from({ length: children }, (_, index) => ({ id: index + 1, name: "买菜", description: null })),
    },
  ],
});

function inputs(overrides: Partial<StageInputs> = {}): StageInputs {
  return {
    setup: loaded({ user_exists: true }),
    me: loaded<Schemas["UserOut"] | null>(user),
    accounts: loaded([account(1)]),
    trees: [loaded(tree(1, 1))],
    ...overrides,
  };
}

describe("resolveStage", () => {
  it("walks setup -> login -> onboarding -> app", () => {
    expect(resolveStage(inputs({ setup: loaded({ user_exists: false }) }))).toEqual({
      status: "ready",
      stage: "setup",
    });
    expect(resolveStage(inputs({ me: loaded(null) }))).toEqual({ status: "ready", stage: "login" });
    expect(resolveStage(inputs({ accounts: loaded([]), trees: [] }))).toEqual({
      status: "ready",
      stage: "onboarding",
    });
    expect(resolveStage(inputs())).toEqual({ status: "ready", stage: "app" });
  });

  it("is loading while the deciding step has no answer yet", () => {
    expect(resolveStage(inputs({ setup: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ me: loading() }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ accounts: loading(), trees: [] }))).toEqual({ status: "loading" });
    expect(resolveStage(inputs({ trees: [loading()] }))).toEqual({ status: "loading" });
  });

  it("resumes onboarding for an account without a usable category", () => {
    expect(resolveStage(inputs({ trees: [loaded(tree(1, 0))] }))).toEqual({
      status: "ready",
      stage: "onboarding",
    });
  });

  it("lets one usable account open the app while another is loading or failed", () => {
    const accounts = loaded([account(1), account(2)]);
    expect(resolveStage(inputs({ accounts, trees: [loading(), loaded(tree(2, 1))] }))).toEqual({
      status: "ready",
      stage: "app",
    });
    expect(resolveStage(inputs({ accounts, trees: [failed("boom"), loaded(tree(2, 1))] }))).toEqual({
      status: "ready",
      stage: "app",
    });
    expect(resolveStage(inputs({ accounts, trees: [failed("boom"), loaded(tree(2, 0))] }))).toMatchObject({
      status: "error",
      error: "boom",
    });
  });

  it("sends an ended session to login even if a later query failed on its first load", () => {
    // `me` went null on a 401 while `accounts` was still failing from the same 401.
    const state = resolveStage(inputs({ me: loaded(null), accounts: failed("401"), trees: [] }));
    expect(state).toEqual({ status: "ready", stage: "login" });
  });

  it("reports the failing step and retries that step", () => {
    const refetch = vi.fn();
    const state = resolveStage(inputs({ setup: failed("down", refetch) }));
    expect(state).toMatchObject({ status: "error", error: "down" });
    if (state.status === "error") state.retry();
    expect(refetch).toHaveBeenCalledOnce();

    expect(resolveStage(inputs({ me: failed("500") }))).toMatchObject({ status: "error", error: "500" });
    expect(resolveStage(inputs({ accounts: failed("500"), trees: [] }))).toMatchObject({
      status: "error",
      error: "500",
    });
  });
});
