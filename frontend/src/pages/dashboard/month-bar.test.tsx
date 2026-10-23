import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { MonthBar } from "./month-bar";

function renderBar(month: string, shown = 3) {
  const onMonthChange = vi.fn();
  render(
    <MonthBar
      month={month}
      current="2026-10"
      min="2025-11"
      max="2027-10"
      shown={shown}
      onMonthChange={onMonthChange}
    />,
  );
  return onMonthChange;
}

const listed = () =>
  within(screen.getByRole("navigation", { name: "选择月份" }))
    .getAllByRole("button", { name: /^\d{4}年\d+月$/ })
    .map((button) => button.getAttribute("aria-label"));

describe("MonthBar", () => {
  it("lists 12 months up to two after the current one, with a year label where each year starts", () => {
    renderBar("2026-10");
    expect(listed()[0]).toBe("2026年1月");
    expect(listed()[11]).toBe("2026年12月");
    expect(screen.getByRole("button", { name: "2026年10月" })).toHaveAttribute("aria-current", "date");
    const nav = screen.getByRole("navigation");
    expect(within(nav).getByText("2026")).toBeInTheDocument();
    expect(within(nav).queryByText("2025")).not.toBeInTheDocument();
  });

  it("slides to reach a month outside the default window", () => {
    renderBar("2027-03");
    expect(listed()[0]).toBe("2026年4月");
    expect(listed()[11]).toBe("2027年3月");
    expect(within(screen.getByRole("navigation")).getByText("2027")).toBeInTheDocument();

    cleanup();
    renderBar("2025-11");
    expect(listed()[0]).toBe("2025年11月");
  });

  it("marks the selected month and selects another, future ones included", async () => {
    const user = userEvent.setup();
    const onMonthChange = renderBar("2026-08");
    expect(screen.getByRole("button", { name: "2026年8月" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "2026年9月" })).toHaveAttribute("aria-pressed", "false");
    await user.click(screen.getByRole("button", { name: "2026年12月" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-12");
  });

  it("steps one month with the arrows, within the selectable range", async () => {
    const user = userEvent.setup();
    const onMonthChange = renderBar("2026-10");
    await user.click(screen.getByRole("button", { name: "下一个月" }));
    expect(onMonthChange).toHaveBeenCalledWith("2026-11");

    cleanup();
    renderBar("2027-10");
    expect(screen.getByRole("button", { name: "下一个月" })).toBeDisabled();

    cleanup();
    renderBar("2025-11");
    expect(screen.getByRole("button", { name: "上一个月" })).toBeDisabled();
  });
});
