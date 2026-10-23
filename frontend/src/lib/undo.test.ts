import { afterEach, describe, expect, it, vi } from "vitest";

import { clearUndo, currentUndo, pushUndo, undoLast } from "./undo";

afterEach(clearUndo);

describe("undo", () => {
  it("runs the last change once", async () => {
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    pushUndo(first);
    pushUndo(second);
    expect(await undoLast()).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(await undoLast()).toBe(false);
  });

  it("ignores an older toast's undo", async () => {
    const first = vi.fn(async () => {});
    const old = pushUndo(first);
    pushUndo(async () => {});
    expect(await undoLast(old)).toBe(false);
    expect(first).not.toHaveBeenCalled();
  });

  it("empties the slot even when the undo fails", async () => {
    pushUndo(async () => {
      throw new Error("refused");
    });
    await expect(undoLast()).rejects.toThrow("refused");
    expect(currentUndo()).toBeNull();
  });
});
