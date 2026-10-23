import { useCallback, useSyncExternalStore } from "react";

// The same key as the inline script in index.html, which applies it before first paint.
const STORAGE_KEY = "eg-privacy";
const CLASS = "privacy";
const listeners = new Set<() => void>();

function current(): boolean {
  return document.documentElement.classList.contains(CLASS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(on: boolean): void {
  document.documentElement.classList.toggle(CLASS, on);
  try {
    localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Privacy mode: while on, every element with the `amount` class is blurred (index.css)
 * and chart axes print no figures. Purely visual; stored on this device only.
 */
export function usePrivacy(): { hidden: boolean; toggle: () => void } {
  const hidden = useSyncExternalStore(subscribe, current, () => false);
  const toggle = useCallback(() => apply(!current()), []);
  return { hidden, toggle };
}
