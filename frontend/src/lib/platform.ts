/** "Ctrl" on most systems, "⌘" on Apple ones, for the labels of modifier shortcuts. */
export function modLabel(): string {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
}
