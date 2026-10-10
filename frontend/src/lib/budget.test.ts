import { describe, expect, it } from "vitest";

import { countByState, usage, usagePercent } from "./budget";

describe("usage", () => {
  it("has no state without a budget", () => {
    expect(usage(null, "99.80")).toEqual({ state: "none", remaining: null, ratio: null });
  });

  it("is ok below the threshold", () => {
    expect(usage("1000.00", "470.00")).toEqual({ state: "ok", remaining: "530.00", ratio: 0.47 });
  });

  it("is near from 85% up to exactly 100%", () => {
    expect(usage("1000.00", "849.99").state).toBe("ok");
    expect(usage("1000.00", "850.00").state).toBe("near");
    expect(usage("6500.00", "6500.00")).toEqual({ state: "near", remaining: "0.00", ratio: 1 });
  });

  it("is over as soon as the actual exceeds the budget", () => {
    const over = usage("1320.00", "3190.70");
    expect(over.state).toBe("over");
    expect(over.remaining).toBe("-1870.70");
    expect(usage("1000.00", "1000.01").state).toBe("over");
  });

  it("treats a zero budget as a real budget", () => {
    expect(usage("0.00", "0.00")).toEqual({ state: "ok", remaining: "0.00", ratio: null });
    expect(usage("0.00", "5.00")).toEqual({ state: "over", remaining: "-5.00", ratio: null });
  });

  it("lets refunds push the actual below zero", () => {
    const refunded = usage("800.00", "-1280.00");
    expect(refunded.state).toBe("ok");
    expect(refunded.remaining).toBe("2080.00");
    expect(usagePercent(refunded)).toBe("0%");
  });

  it("formats the percentage, or nothing when there is no ratio", () => {
    expect(usagePercent(usage("1320.00", "3190.70"))).toBe("242%");
    expect(usagePercent(usage(null, "1.00"))).toBeNull();
    expect(usagePercent(usage("0.00", "1.00"))).toBeNull();
  });

  it("counts rows by state", () => {
    expect(
      countByState([
        { budget: null, actual: "1.00" },
        { budget: "10.00", actual: "1.00" },
        { budget: "10.00", actual: "9.00" },
        { budget: "10.00", actual: "11.00" },
        { budget: "10.00", actual: "12.00" },
      ]),
    ).toEqual({ none: 1, ok: 1, near: 1, over: 2 });
  });
});
