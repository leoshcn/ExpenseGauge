import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CreateBudgetAccountDialog } from "./budget-account-dialog";

function renderDialog() {
  const onSubmit = vi.fn(async () => undefined);
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CreateBudgetAccountDialog onSubmit={onSubmit} onClose={onClose} />
    </QueryClientProvider>,
  );
  return { onSubmit, onClose, dialog: screen.getByRole("dialog") };
}

describe("CreateBudgetAccountDialog", () => {
  it("creates a monthly budget account by default", async () => {
    const user = userEvent.setup();
    const { onSubmit, onClose, dialog } = renderDialog();
    expect(within(dialog).getByRole("radio", { name: /月度/ })).toBeChecked();
    await user.type(within(dialog).getByLabelText("预算账户名称"), "日常");
    await user.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "日常", period: "month" });
  });

  it("creates an annual one when chosen", async () => {
    const user = userEvent.setup();
    const { onSubmit, dialog } = renderDialog();
    expect(within(dialog).getByText("创建后不能更改周期。")).toBeInTheDocument();
    await user.type(within(dialog).getByLabelText("预算账户名称"), "年度");
    await user.click(within(dialog).getByRole("radio", { name: /年度/ }));
    await user.click(within(dialog).getByRole("button", { name: "创建" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledExactlyOnceWith({ name: "年度", period: "year" }));
  });
});
