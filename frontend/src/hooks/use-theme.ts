import { useCallback, useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

// The same key and rule as the inline script in index.html, which runs before first paint.
const STORAGE_KEY = "eg-theme";
const listeners = new Set<() => void>();

function current(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function apply(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  listeners.forEach((listener) => listener());
}

/** The theme in effect, and a toggle. The first visit follows the system setting. */
export function useTheme(): { theme: Theme; toggle: () => void } {
  const theme = useSyncExternalStore(subscribe, current, () => "light" as Theme);
  const toggle = useCallback(() => apply(current() === "dark" ? "light" : "dark"), []);
  return { theme, toggle };
}
