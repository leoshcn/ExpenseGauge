import { describe, expect, it } from "vitest";

import { evaluate, isExpression } from "./expr";

describe("evaluate", () => {
  it.each([
    ["1800*1.1", "1980.00"],
    ["(300+250)/2", "275.00"],
    ["100/3", "33.33"],
    ["200/3", "66.67"],
    ["1.005*1", "1.01"],
    ["10-2.5", "7.50"],
    ["-5+10", "5.00"],
    ["2*-3", "-6.00"],
    ["1,200+300", "1500.00"],
    ["１２×３", "36.00"],
    ["（1+2）÷3", "1.00"],
    [" 7 ", "7.00"],
    ["0.1+0.2", "0.30"],
  ])("%s = %s", (text, value) => {
    expect(evaluate(text)).toEqual({ ok: true, value });
  });

  it.each(["", "12+", "*3", "1/0", "(1+2", "1+2)", "abc", "1..2", "99999999999999*10"])(
    "%j is invalid",
    (text) => {
      expect(evaluate(text)).toEqual({ ok: false });
    },
  );
});

describe("isExpression", () => {
  it("tells a calculation from a plain amount", () => {
    expect(isExpression("1800*1.1")).toBe(true);
    expect(isExpression("12+")).toBe(true);
    expect(isExpression("1,200.50")).toBe(false);
    expect(isExpression("")).toBe(false);
  });
});
