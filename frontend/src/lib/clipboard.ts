/**
 * Copies text. The Clipboard API exists only in secure contexts (HTTPS or localhost), and
 * the app is usually opened over plain HTTP on a LAN address, so there is a fallback
 * through a hidden textarea and `execCommand("copy")`. Resolves to whether it worked.
 */
export async function copyText(text: string): Promise<boolean> {
  if (globalThis.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permission denied: try the fallback below.
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  const active = document.activeElement as HTMLElement | null;
  area.select();
  let copied: boolean;
  try {
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  active?.focus();
  return copied;
}
