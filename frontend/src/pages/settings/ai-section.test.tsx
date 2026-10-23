import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Schemas } from "@/api/client";
import type * as Queries from "@/api/queries";

const KEY = "sk-new-secret-key-9876";

const server: { settings: Schemas["AiSettingsOut"] } = {
  settings: {
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    api_key_set: true,
    api_key_hint: "abcd",
    configured: true,
  },
};

const updateAiSettings = vi.fn(async (body: Schemas["AiSettingsUpdateIn"]): Promise<Schemas["AiSettingsOut"]> => {
  const keySet = "api_key" in body ? body.api_key !== null : server.settings.api_key_set;
  server.settings = {
    base_url: body.base_url,
    model: body.model,
    api_key_set: keySet,
    api_key_hint: keySet ? (body.api_key ? body.api_key.slice(-4) : server.settings.api_key_hint) : null,
    configured: true,
  };
  return server.settings;
});
const testAiSettings = vi.fn(async (): Promise<Schemas["AiTestOut"]> => ({ model: "gpt-4o-mini", latency_ms: 1234 }));

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof Queries>();
  return {
    ...actual,
    aiSettingsQuery: { queryKey: actual.keys.aiSettings, queryFn: async () => server.settings },
    updateAiSettings: (body: Schemas["AiSettingsUpdateIn"]) => updateAiSettings(body),
    testAiSettings: () => testAiSettings(),
  };
});

const { AiSection } = await import("./ai-section");

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AiSection />
    </QueryClientProvider>,
  );
  return client;
}

describe("AiSection", () => {
  beforeEach(() => {
    server.settings = {
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      api_key_set: true,
      api_key_hint: "abcd",
      configured: true,
    };
    updateAiSettings.mockClear();
    testAiSettings.mockClear();
  });

  it("leaves the key out when the field is blank, so the stored key is kept", async () => {
    const user = userEvent.setup();
    renderSection();
    const model = await screen.findByLabelText("模型");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "已设置 ····abcd，留空保持不变");
    expect(screen.getByText(/备注和付款渠道不会发送/)).toBeInTheDocument();

    await user.clear(model);
    await user.type(model, "deepseek-chat");
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledTimes(1));
    expect(updateAiSettings.mock.calls[0]?.[0]).toEqual({
      base_url: "https://api.openai.com/v1",
      model: "deepseek-chat",
    });
  });

  it("sends a typed key, then null after 清除, and never keeps the key in the cache", async () => {
    const user = userEvent.setup();
    const client = renderSection();
    const key = await screen.findByLabelText("API Key");

    await user.type(key, KEY);
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledTimes(1));
    expect(updateAiSettings.mock.calls[0]?.[0]).toMatchObject({ api_key: KEY });
    await waitFor(() => expect(screen.getByLabelText("API Key")).toHaveValue(""));
    expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "已设置 ····9876，留空保持不变");

    await user.click(screen.getByRole("button", { name: "清除已保存的 API Key" }));
    expect(screen.getByText("保存后将清除已保存的 API Key。")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() => expect(updateAiSettings).toHaveBeenCalledTimes(2));
    expect(updateAiSettings.mock.calls[1]?.[0]).toEqual({
      base_url: "https://api.openai.com/v1",
      model: "gpt-4o-mini",
      api_key: null,
    });
    await waitFor(() => expect(screen.getByLabelText("API Key")).toHaveAttribute("placeholder", "本地服务（如 Ollama）可留空"));

    const cached = JSON.stringify([
      client.getMutationCache().getAll().map((mutation) => mutation.state),
      client.getQueryCache().getAll().map((query) => query.state),
    ]);
    expect(cached).not.toContain(KEY);
  });

  it("validates the form before saving", async () => {
    const user = userEvent.setup();
    renderSection();
    const baseUrl = await screen.findByLabelText("Base URL");
    await user.clear(baseUrl);
    await user.type(baseUrl, "api.openai.com/v1");
    await user.clear(screen.getByLabelText("模型"));
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("Base URL 应以 http:// 或 https:// 开头")).toBeInTheDocument();
    expect(screen.getByText("请输入模型名")).toBeInTheDocument();
    expect(updateAiSettings).not.toHaveBeenCalled();
  });

  it("refuses a key that cannot travel in an HTTP header", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.type(await screen.findByLabelText("API Key"), "sk-全角ｋｅｙ");
    await user.click(screen.getByRole("button", { name: "保存" }));
    expect(screen.getByText("API Key 只能包含英文字母、数字和符号，不能有空格或中文字符")).toBeInTheDocument();
    expect(screen.getByLabelText("API Key")).toHaveAttribute("aria-invalid", "true");
    expect(updateAiSettings).not.toHaveBeenCalled();
  });

  it("tests the saved configuration and shows the latency", async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole("button", { name: "测试连接" }));
    expect(await screen.findByText("连接成功：gpt-4o-mini，耗时 1.2 秒")).toBeInTheDocument();
    expect(testAiSettings).toHaveBeenCalledTimes(1);
  });

  it("cannot test before a service is saved", async () => {
    server.settings = { base_url: null, model: null, api_key_set: false, api_key_hint: null, configured: false };
    renderSection();
    expect(await screen.findByRole("button", { name: "测试连接" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "清除已保存的 API Key" })).not.toBeInTheDocument();
  });
});
