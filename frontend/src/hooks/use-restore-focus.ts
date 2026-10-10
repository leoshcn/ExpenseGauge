import { useEffect, useState } from "react";

/**
 * Gives focus back to whatever had it before this component mounted, when it unmounts.
 *
 * Dialogs here are rendered only while open and have no Radix `Trigger`, so Radix has no
 * element to return focus to and it would land on `<body>`. The element is read during
 * the first render, before the dialog's focus trap moves focus inside. If that element
 * is gone (the deleted row's button), focus stays where the browser puts it.
 */
export function useRestoreFocus() {
  const [previous] = useState(() =>
    typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null),
  );
  useEffect(
    () => () => {
      // After Radix has finished its own unmount focus handling.
      requestAnimationFrame(() => {
        if (previous?.isConnected && previous !== document.body) previous.focus();
      });
    },
    [previous],
  );
}
