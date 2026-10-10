import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

const SECRET = "eg_secret-token-value";

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    tokensQuery: { queryKey: actual.keys.tokens, queryFn: async () => [] },
    createToken: vi.fn(
      async (body: Schemas["TokenCreateIn"]): Promise<Schemas["TokenCreatedOut"]> => ({
        id: 7,
        name: body.name,
        created_at: "2026-10-10T00:00:00Z",
        last_used_at: null,
        revoked_at: null,
        token: SECRET,
      }),
    ),
  };
});

const { AgentSection } = await import("./agent-section");

describe("AgentSection", () => {
  it("keeps the one-time token nowhere in TanStack Query once its dialog closes", async () => {
    const user = userEvent.setup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <AgentSection accounts={[{ id: 1, name: "日常账户", currency: "CNY" }]} />
      </QueryClientProvider>,
    );

    await user.type(screen.getByLabelText("令牌名称"), "Hermes");
    await user.click(screen.getByRole("button", { name: "创建令牌" }));
    expect(await screen.findByDisplayValue(SECRET)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "我已保存令牌" }));
    await waitFor(() => expect(screen.queryByDisplayValue(SECRET)).not.toBeInTheDocument());

    const cached = () =>
      JSON.stringify([
        client.getMutationCache().getAll().map((mutation) => mutation.state),
        client.getQueryCache().getAll().map((query) => query.state),
      ]);
    await waitFor(() => expect(cached()).not.toContain(SECRET));
  });
});
