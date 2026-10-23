"""Tags in transaction notes (`app/tags.py` defines the syntax): which transactions carry
a tag, every tag in use, and renaming one everywhere.

Tags are parsed in Python, never with a database regex, so the server and the frontend
(`src/lib/tags.ts`) cannot disagree. A `LIKE '%#…%'` narrows the rows first.
"""

from collections import Counter

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import invalid, not_found
from app.models import Transaction
from app.schemas.transaction import MAX_NOTE_LENGTH, NoteChange, TagCount, TagRenameOut
from app.services.refunds import effective_note, join_payment, lock_transactions
from app.tags import is_valid_tag, parse_tags, replace_tag


def _like(tag: str) -> str:
    escaped = tag.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%#{escaped}%"


def tagged_ids(db: Session, tags: list[str]) -> set[int]:
    """Ids of the transactions whose effective note (a matched refund's is its payment's)
    has any of `tags`."""
    wanted = set(tags)
    rows = db.execute(
        join_payment(select(Transaction.id, effective_note)).where(effective_note.like("%#%"))
    ).all()
    return {row_id for row_id, note in rows if wanted.intersection(parse_tags(note))}


def list_tags(db: Session) -> list[TagCount]:
    """Every tag written in a note, with the number of transactions that have it; most
    used first, then by name."""
    counts: Counter[str] = Counter()
    for note in db.scalars(select(Transaction.note).where(Transaction.note.like("%#%"))):
        counts.update(parse_tags(note))
    ordered = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    return [TagCount(tag=tag, count=count) for tag, count in ordered]


def rename_tag(db: Session, from_tag: str, to_tag: str) -> TagRenameOut:
    """Writes `#from_tag` as `#to_tag` in every note, whole tags only; returns each changed
    note as it was, so the change can be undone (`PATCH`-style through bulk-update)."""
    details = {"from_tag": from_tag, "to_tag": to_tag}
    if not is_valid_tag(to_tag):
        raise invalid("INVALID_TAG", "新标签不能包含空格、# 或标点，最多 50 个字", details)
    if from_tag == to_tag:
        raise invalid("INVALID_TAG", "新旧标签相同", details)
    pattern = _like(from_tag)
    candidates = list(
        db.scalars(select(Transaction.id).where(Transaction.note.like(pattern, escape="\\")))
    )
    locked = lock_transactions(db, set(candidates))
    changed: list[NoteChange] = []
    for transaction in sorted(locked.values(), key=lambda row: row.id):
        before = transaction.note or ""
        if from_tag not in parse_tags(before):
            continue
        after = replace_tag(before, from_tag, to_tag)
        if len(after) > MAX_NOTE_LENGTH:
            db.rollback()
            raise invalid(
                "NOTE_TOO_LONG",
                f"重命名后流水 {transaction.id} 的备注将超过 {MAX_NOTE_LENGTH} 字",
                {**details, "transaction_id": transaction.id, "max_length": MAX_NOTE_LENGTH},
            )
        transaction.note = after
        changed.append(NoteChange(transaction_id=transaction.id, note_before=before))
    if not changed:
        db.rollback()
        raise not_found("TAG_NOT_FOUND", f"没有流水带有标签 #{from_tag}")
    db.commit()
    return TagRenameOut(changed=changed)
