import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useHotkey, useMonthHotkeys } from "./use-hotkey";
import { usePrivacy } from "./use-privacy";

describe("useHotkey", () => {
  it("fires on the page but not while typing in an input", () => {
    const handler = vi.fn();
    function Probe() {
      useHotkey({ key: "0" }, handler);
      return <input aria-label="field" />;
    }
    render(<Probe />);
    fireEvent.keyDown(document.body, { key: "0" });
    expect(handler).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "0" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("checks modifiers: Ctrl+K is not K, and fires while typing when allowed", () => {
    const handler = vi.fn();
    function Probe() {
      useHotkey({ key: "k", mod: true }, handler, { whileTyping: true });
      return <input aria-label="field" />;
    }
    render(<Probe />);
    fireEvent.keyDown(document.body, { key: "k" });
    expect(handler).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "k", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "k", metaKey: true });
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("matches Shift+H whatever the letter's case", () => {
    const handler = vi.fn();
    renderHook(() => useHotkey({ key: "h", shift: true }, handler));
    fireEvent.keyDown(document.body, { key: "h" });
    fireEvent.keyDown(document.body, { key: "H", shiftKey: true });
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("useMonthHotkeys", () => {
  it("steps within the bounds and returns to the current month", () => {
    const onChange = vi.fn();
    const { rerender } = renderHook(
      ({ month }) => useMonthHotkeys({ month, current: "2026-10", onChange, min: "2025-11", max: "2026-10" }),
      { initialProps: { month: "2026-10" } },
    );
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith("2026-09");
    rerender({ month: "2025-11" });
    fireEvent.keyDown(document.body, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: "0" });
    expect(onChange).toHaveBeenLastCalledWith("2026-10");
  });
});

describe("usePrivacy", () => {
  it("toggles the class on <html> and remembers it", () => {
    const { result } = renderHook(() => usePrivacy());
    expect(result.current.hidden).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.hidden).toBe(true);
    expect(document.documentElement).toHaveClass("privacy");
    expect(localStorage.getItem("eg-privacy")).toBe("on");
    act(() => result.current.toggle());
    expect(document.documentElement).not.toHaveClass("privacy");
  });
});
