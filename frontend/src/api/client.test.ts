import { describe, expect, it } from "vitest";

import { S } from "@/strings.zh";

import { ApiError, createApi, errorMessage, isApiError, unwrap } from "./client";

function apiReturning(response: () => Response | Promise<Response>) {
  return createApi({ baseUrl: "http://test.local", fetch: async () => response() });
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ApiError) return error;
    throw error;
  }
  throw new Error("expected the request to fail");
}

describe("unwrap", () => {
  it("returns the body of a 2xx response", async () => {
    const api = apiReturning(() => json(200, { user_exists: true }));
    await expect(unwrap(api.GET("/api/v1/setup/status"))).resolves.toEqual({ user_exists: true });
  });

  it("resolves a 204 without a body", async () => {
    const api = apiReturning(() => new Response(null, { status: 204 }));
    await expect(unwrap(api.POST("/api/v1/auth/logout"))).resolves.toBeUndefined();
  });

  it("surfaces the error envelope", async () => {
    const api = apiReturning(() =>
      json(409, { code: "CATEGORY_IN_USE", message: "该分类下已有流水，无法删除", details: { count: 3 } }),
    );
    const error = await failure(unwrap(api.GET("/api/v1/channels")));
    expect(error).toMatchObject({
      status: 409,
      code: "CATEGORY_IN_USE",
      message: "该分类下已有流水，无法删除",
      details: { count: 3 },
    });
    expect(isApiError(error, "CATEGORY_IN_USE")).toBe(true);
    expect(isApiError(error, "OTHER")).toBe(false);
    expect(errorMessage(error)).toBe("该分类下已有流水，无法删除");
  });

  it("reports a proxy error page as an unreachable server", async () => {
    const api = apiReturning(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
    const error = await failure(unwrap(api.GET("/api/v1/channels")));
    expect(error).toMatchObject({ status: 502, code: "NETWORK_ERROR", message: S.errors.network });
  });

  it("reports any other non-envelope failure as unexpected", async () => {
    const api = apiReturning(() => json(500, { detail: "boom" }));
    const error = await failure(unwrap(api.GET("/api/v1/channels")));
    expect(error).toMatchObject({ status: 500, code: "UNEXPECTED_RESPONSE", message: S.errors.unexpected });
  });

  it("reports a failed connection", async () => {
    const api = apiReturning(() => Promise.reject(new TypeError("fetch failed")));
    const error = await failure(unwrap(api.GET("/api/v1/channels")));
    expect(error).toMatchObject({ status: 0, code: "NETWORK_ERROR", message: S.errors.network });
  });

  it("has a message for values that are not ApiError", () => {
    expect(errorMessage(new Error("x"))).toBe(S.errors.unexpected);
  });
});
