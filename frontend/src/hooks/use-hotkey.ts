import { useEffect, useRef } from "react";

import { addMonths } from "@/lib/month";

/**
 * A key combination: `key` is `KeyboardEvent.key` ("ArrowLeft", "0", "?", "k"), compared
 * case-insensitively for letters. `mod` means Ctrl, or ⌘ on macOS.
 */
export type Hotkey = { key: string; mod?: boolean; shift?: boolean };

/** True when the event comes from somewhere the user types, where keys mean text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "submit", "reset"].includes(type);
  }
  return target.getAttribute("role") === "combobox";
}

/** True while a modal dialog (Radix sets `role="dialog"` with `data-state="open"`) is open. */
function dialogOpen(): boolean {
  return document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]') !== null;
}

export function matches(event: KeyboardEvent, hotkey: Hotkey): boolean {
  const mod = event.ctrlKey || event.metaKey;
  if (Boolean(hotkey.mod) !== mod || event.altKey) return false;
  // "?" and other shifted symbols arrive with shiftKey set; only letters and arrows check it.
  const symbol = hotkey.key.length === 1 && !/[a-z0-9]/i.test(hotkey.key);
  if (!symbol && Boolean(hotkey.shift) !== event.shiftKey) return false;
  return event.key.toLowerCase() === hotkey.key.toLowerCase();
}

/**
 * Runs `handler` on the key combination, anywhere on the page, except while the user is
 * typing or a dialog is open (`global` combinations with a modifier still fire while
 * typing, e.g. Ctrl+K). `enabled: false` unbinds it.
 */
export function useHotkey(
  hotkey: Hotkey,
  handler: (event: KeyboardEvent) => void,
  { enabled = true, whileTyping = false }: { enabled?: boolean; whileTyping?: boolean } = {},
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const { key, mod, shift } = hotkey;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (!matches(event, { key, mod, shift })) return;
      if (!whileTyping && (isTypingTarget(event.target) || dialogOpen())) return;
      event.preventDefault();
      latest.current(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, key, mod, shift, whileTyping]);
}

/**
 * ← / → step the month, 0 returns to `current`. `min` / `max` bound the steps (the
 * Dashboard's 12-month window); leave them out for no bound.
 */
export function useMonthHotkeys({
  month,
  current,
  onChange,
  min,
  max,
}: {
  month: string;
  current: string;
  onChange: (month: string) => void;
  min?: string;
  max?: string;
}): void {
  const go = (next: string) => {
    if ((min === undefined || next >= min) && (max === undefined || next <= max) && next !== month) onChange(next);
  };
  useHotkey({ key: "ArrowLeft" }, () => go(addMonths(month, -1)));
  useHotkey({ key: "ArrowRight" }, () => go(addMonths(month, 1)));
  useHotkey({ key: "0" }, () => go(current));
}
