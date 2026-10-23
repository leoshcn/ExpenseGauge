import { QueryClient, QueryClientProvider, queryOptions } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, type Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

const insight = (first: string): Schemas["InsightOut"] => ({
  lines: [
    { tone: "warning", text: first },
    { tone: "positive", text: "外食低于预算。" },
  ],
  model: "gpt-test",
  generated_at: "2026-10-12T08:30:00Z",
});

const server: { state: Schemas["InsightStateOut"]; generate: () => Promise<Schemas["InsightStateOut"]> } = {
  state: { month: "2026-09", configured: true, insight: null, stale: false },
  generate: async () => ({ month: "2026-09", configured: true, insight: insight("新的总结"), stale: false }),
};
const generateInsight = vi.fn((month: string) => {
  void month;
  return server.generate();
});

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    insightQuery: (month: string) =>
      queryOptions({ queryKey: actual.keys.insight(month), queryFn: async () => ({ ...server.state, month }) }),
    generateInsight: (month: string) => generateInsight(month),
  };
});

const { InsightCard } = await import("./insight-card");

function renderCard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <InsightCard month="2026-09" />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const card = async () => (await screen.findByRole("heading", { name: "AI 洞察" })).closest("section")!;

describe("InsightCard", () => {
  beforeEach(() => {
    server.state = { month: "2026-09", configured: true, insight: null, stale: false };
    server.generate = async () => ({ month: "2026-09", configured: true, insight: insight("新的总结"), stale: false });
    generateInsight.mockClear();
  });

  it("points to the settings and offers no generate button when no service is configured", async () => {
    server.state = { ...server.state, configured: false };
    renderCard();
    const section = await card();
    expect(await within(section).findByText(/^尚未配置 AI 服务/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: "去设置" })).toHaveAttribute("href", "/settings?tab=ai");
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });

  it("generates on request and shows its one or two sentences, model and time", async () => {
    const user = userEvent.setup();
    renderCard();
    const section = await card();
    expect(await within(section).findByText(/^点击生成/)).toBeInTheDocument();
    expect(generateInsight).not.toHaveBeenCalled();

    await user.click(within(section).getByRole("button", { name: "生成洞察" }));
    expect(generateInsight).toHaveBeenCalledWith("2026-09");
    expect(await within(section).findByText("新的总结")).toBeInTheDocument();
    expect(within(section).getByText("外食低于预算。")).toBeInTheDocument();
    expect(within(section).getAllByRole("listitem")).toHaveLength(2);
    expect(within(section).getByText("需要注意：")).toBeInTheDocument();
    expect(within(section).getByText(/^gpt-test · 生成于 /)).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "重新生成" })).toBeInTheDocument();
  });

  it("marks a cached insight whose data changed", async () => {
    server.state = { ...server.state, insight: insight("旧的总结"), stale: true };
    renderCard();
    const section = await card();
    expect(await within(section).findByText("旧的总结")).toBeInTheDocument();
    expect(within(section).getByText("数据已更新，可重新生成")).toBeInTheDocument();
    expect(generateInsight).not.toHaveBeenCalled();
  });

  it("keeps the previous insight and shows the reason when generating fails", async () => {
    const user = userEvent.setup();
    server.state = { ...server.state, insight: insight("旧的总结") };
    server.generate = async () => {
      throw new ApiError(502, "AI_INVALID_RESPONSE", "AI 服务返回的内容无法识别，请重试或换用其他模型");
    };
    renderCard();
    const section = await card();
    await within(section).findByText("旧的总结");
    expect(within(section).queryByText("数据已更新，可重新生成")).not.toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "重新生成" }));
    expect(await within(section).findByRole("alert")).toHaveTextContent(
      "生成失败：AI 服务返回的内容无法识别，请重试或换用其他模型",
    );
    expect(within(section).getByText("旧的总结")).toBeInTheDocument();
  });
});
