import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { isValidTag, parseTags, splitNote, tagAtCaret } from "./tags";

// The backend's vectors: both parsers must agree on every one.
const vectors = JSON.parse(
  readFileSync(resolve(process.cwd(), "../backend/tests/tag_vectors.json"), "utf-8"),
) as { note: string | null; tags: string[] }[];

describe("parseTags", () => {
  it.each(vectors.map((vector) => [JSON.stringify(vector.note), vector] as const))("%s", (_, vector) => {
    expect(parseTags(vector.note)).toEqual(vector.tags);
  });
});

describe("splitNote", () => {
  it("keeps the text around the tags", () => {
    expect(splitNote("和家人 #国庆2026，开心 ##x")).toEqual([
      { kind: "text", text: "和家人 " },
      { kind: "tag", tag: "国庆2026" },
      { kind: "text", text: "，开心 ##x" },
    ]);
  });
});

describe("tagAtCaret", () => {
  it("finds the tag being typed", () => {
    expect(tagAtCaret("晚饭 #国", 5)).toEqual({ query: "国", start: 3 });
    expect(tagAtCaret("晚饭 #", 4)).toEqual({ query: "", start: 3 });
    expect(tagAtCaret("晚饭 #国 ", 6)).toBeNull();
    expect(tagAtCaret("##", 2)).toBeNull();
  });
});

describe("isValidTag", () => {
  it("accepts a name a note could hold", () => {
    expect(isValidTag("国庆")).toBe(true);
    expect(isValidTag("两 词")).toBe(false);
    expect(isValidTag("a，b")).toBe(false);
    expect(isValidTag("")).toBe(false);
  });
});
