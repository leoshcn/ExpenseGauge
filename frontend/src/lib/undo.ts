/**
 * One-slot undo for the transactions page: the last change the user made there and how to
 * reverse it. A new change replaces the slot; running it empties the slot. The toast's
 * "撤销" button and Ctrl/⌘+Z call the same `undoLast()`.
 */

export type UndoAction = {
  /** Identifies the change, so a toast can tell whether it is still the undoable one. */
  id: number;
  run: () => Promise<void>;
};

let slot: UndoAction | null = null;
let nextId = 1;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

export function subscribeUndo(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentUndo(): UndoAction | null {
  return slot;
}

/** Makes `run` the change to undo; returns its id. */
export function pushUndo(run: () => Promise<void>): number {
  slot = { id: nextId++, run };
  notify();
  return slot.id;
}

/**
 * Reverses the last change (only `id`'s, when given). Resolves to false when there was
 * nothing to undo; rejects with the request's error when the undo failed, in which case
 * the slot is empty too (the same undo is not offered twice).
 */
export async function undoLast(id?: number): Promise<boolean> {
  const action = slot;
  if (action === null || (id !== undefined && action.id !== id)) return false;
  slot = null;
  notify();
  await action.run();
  return true;
}

export function clearUndo(): void {
  if (slot === null) return;
  slot = null;
  notify();
}
