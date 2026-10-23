/**
 * Tags written in a transaction's note: `#国庆2026`. The same rule as the backend's
 * `app/tags.py`, tested against the same vectors (`backend/tests/tag_vectors.json`): a tag
 * starts at a `#` that does not follow another `#` and runs to the next whitespace, `#` or
 * punctuation mark in `TERMINATORS`; case-sensitive; at most `MAX_TAG_LENGTH` characters
 * (a longer run is not a tag). `##` is a literal `#`.
 */

export const MAX_TAG_LENGTH = 50;
const TERMINATORS = ",，。、;；:：!！?？()（）【】[]「」\"“”'";
const CLASS = TERMINATORS.replace(/[\]\\^-]/g, "\\$&");
const TAG = new RegExp(`(?<!#)#([^\\s#${CLASS}]+)`, "gu");
const WHOLE = new RegExp(`^[^\\s#${CLASS}]{1,${MAX_TAG_LENGTH}}$`, "u");

/** Whether `name` (without the `#`) can be written as a tag. */
export function isValidTag(name: string): boolean {
  return WHOLE.test(name);
}

/** The note's tags in order of first appearance, without duplicates. */
export function parseTags(note: string | null | undefined): string[] {
  if (!note) return [];
  const found = new Set<string>();
  for (const match of note.matchAll(TAG)) {
    const name = match[1]!;
    if ([...name].length <= MAX_TAG_LENGTH) found.add(name);
  }
  return [...found];
}

export type NotePart = { kind: "text"; text: string } | { kind: "tag"; tag: string };

/** The note as text and tags, in order, for drawing each tag as a chip. */
export function splitNote(note: string): NotePart[] {
  const parts: NotePart[] = [];
  let last = 0;
  for (const match of note.matchAll(TAG)) {
    const name = match[1]!;
    if ([...name].length > MAX_TAG_LENGTH) continue;
    if (match.index > last) parts.push({ kind: "text", text: note.slice(last, match.index) });
    parts.push({ kind: "tag", tag: name });
    last = match.index + match[0].length;
  }
  if (last < note.length) parts.push({ kind: "text", text: note.slice(last) });
  return parts;
}

/**
 * The tag being typed at `caret`: the text after a `#` up to the caret, when the caret is
 * inside a tag (for autocompletion), with where it starts; else null.
 */
export function tagAtCaret(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = new RegExp(`(?<!#)#([^\\s#${CLASS}]*)$`, "u").exec(before);
  if (!match) return null;
  return { query: match[1]!, start: match.index };
}
