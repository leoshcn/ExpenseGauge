import { describe, expect, it } from "vitest";

import { ApiError } from "./client";
import { keys } from "./queries";
import { createQueryClient } from "./query-client";

const user = { id: 1, username: "demo", created_at: "2026-10-10T00:00:00Z" };
const expired = new ApiError(401, "NOT_AUTHENTICATED", "请先登录");

describe("createQueryClient", () => {
  it("signs the user out of the cache when a query gets a 401", async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, user);
    await client
      .fetchQuery({ queryKey: keys.channels, queryFn: () => Promise.reject(expired) })
      .catch(() => {});
    expect(client.getQueryData(keys.me)).toBeNull();
  });

  it("does the same when a mutation gets a 401", async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, user);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(expired),
    });
    await mutation.execute(undefined).catch(() => {});
    expect(client.getQueryData(keys.me)).toBeNull();
  });

  it("keeps the session on other errors", async () => {
    const client = createQueryClient();
    client.setQueryData(keys.me, user);
    const mutation = client.getMutationCache().build(client, {
      mutationFn: () => Promise.reject(new ApiError(422, "VALIDATION_ERROR", "无效")),
    });
    await mutation.execute(undefined).catch(() => {});
    expect(client.getQueryData(keys.me)).toEqual(user);
  });
});
