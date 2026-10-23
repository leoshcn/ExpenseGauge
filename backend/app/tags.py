"""Tags written in a transaction's note: `#国庆2026`, `#travel`.

A tag starts at a `#` that does not follow another `#` and runs to the next whitespace,
`#` or punctuation mark in `TERMINATORS`; it is case-sensitive and at most
`MAX_TAG_LENGTH` characters (a longer run is not a tag). `##` is a literal `#`. The
frontend's `src/lib/tags.ts` implements the same rule; both are tested against
`tests/tag_vectors.json`.
"""

import re

MAX_TAG_LENGTH = 50
# Punctuation that ends a tag, so "#国庆，很开心" is the tag "国庆".
TERMINATORS = ",，。、;；:：!！?？()（）【】[]「」\"“”'"
_CLASS = re.escape(TERMINATORS)
_TAG = re.compile(rf"(?<!#)#([^\s#{_CLASS}]+)")
_WHOLE = re.compile(rf"[^\s#{_CLASS}]{{1,{MAX_TAG_LENGTH}}}")


def is_valid_tag(name: str) -> bool:
    """Whether `name` (without the `#`) can be written as a tag."""
    return _WHOLE.fullmatch(name) is not None


def parse_tags(note: str | None) -> list[str]:
    """The note's tags in order of first appearance, without duplicates."""
    if not note:
        return []
    found: dict[str, None] = {}
    for match in _TAG.finditer(note):
        name = match.group(1)
        if len(name) <= MAX_TAG_LENGTH:
            found.setdefault(name)
    return list(found)


def replace_tag(note: str, old: str, new: str) -> str:
    """`note` with every occurrence of the tag `old` written as `new`."""

    def replace(match: re.Match[str]) -> str:
        return f"#{new}" if match.group(1) == old else match.group(0)

    return _TAG.sub(replace, note)
