import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MonthBar } from "./month-bar";

function renderBar(month: string, shown = 3) {
  const onMonthChange = vi.fn();
  render(<MonthBar month={month} firstMonth="2025-11" lastMonth="2026-10" shown={shown} onMonthChange={onMonthChange} />);
  return onMonthChange;
}

describe("MonthBar", () => {
  it("lists the 12-month window with a year label where each year starts", () => {
    renderBar("2026-10");
    const nav = screen.getByRole("navigation", { name: "选择月份" });
    const buttons = within(nav).getAllByRole("button", { name: /^\d{4}年\d+月$/ });
    expect(buttons).toHaveLength(12);
    expect(buttons[0]).toHaveAccessibleName("2025年11月");
    expect(buttons[11]).toHaveAccessibleName("2026年10月");
    expect(buttons[11]).toHaveAttribute("aria-current", "date");
    expect(within(nav).getByText("2025")).toBeVisible();
    expect(within(nav).getByText("2026")).toBeVisible();
  });

  it("marks the selected month and selects another on click", async () => {
    const user = userEvent.setup();
    const onMonthChange = renderBar("2026-08");
    expect(screen.getByRole("button", { name: "2026年8月" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2026年9月" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "2026年2月" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-02");
  });

  it("steps one month with the arrows, within the window", async () => {
    const user = userEvent.setup();
    const onMonthChange = renderBar("2026-10");
    expect(screen.getByRole("button", { name: "下一个月" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "上一个月" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-09");

    cleanup();
    renderBar("2025-11");
    expect(screen.getByRole("button", { name: "上一个月" })).toBeDisabled();
  });
});
