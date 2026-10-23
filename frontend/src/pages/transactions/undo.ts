import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { errorMessage } from "@/api/client";
import { keys } from "@/api/queries";
import { pushUndo, undoLast } from "@/lib/undo";
import { S } from "@/strings.zh";

const U = S.transactions.undo;
const TOAST_MS = 8000;

/**
 * Everything that shows a transaction's figures changes when one is edited, matched,
 * deleted or restored (a match moves a refund into its payment's month and category).
 */
export function useInvalidateLedger() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: keys.transactions }),
      // Also the Dashboard queries not on screen (every scope: a new category can move the
      // amount to another budget account), so going back never shows stale figures.
      queryClient.invalidateQueries({ queryKey: keys.summaries, refetchType: "all" }),
      queryClient.invalidateQueries({ queryKey: keys.budgets }),
    ]);
}

/** Runs the last undo (only `id`'s, from a toast) and says how it went. */
export async function runUndo(id?: number): Promise<void> {
  try {
    if (await undoLast(id)) toast.success(U.done);
  } catch (error) {
    toast.error(U.failed(errorMessage(error)));
  }
}

/**
 * After a change on the transactions page: offers to reverse it with `reverse` (a toast
 * with "撤销" for a few seconds, and Ctrl/⌘+Z until the next change).
 */
export function useOfferUndo() {
  const invalidate = useInvalidateLedger();
  return (message: string, reverse: () => Promise<unknown>) => {
    const id = pushUndo(async () => {
      try {
        await reverse();
      } finally {
        await invalidate();
      }
    });
    toast(message, {
      id: "transactions-undo",
      duration: TOAST_MS,
      action: { label: U.action, onClick: () => void runUndo(id) },
    });
  };
}
