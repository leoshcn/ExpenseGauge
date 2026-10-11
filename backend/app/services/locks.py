"""PostgreSQL advisory locks, held until the surrounding database transaction ends."""

from sqlalchemy import text
from sqlalchemy.orm import Session

# First key of the two-int advisory lock: one namespace per purpose.
_NS_SETUP = 1001
_NS_CHANNEL_TRANSACTIONS = 1002


def lock_setup(db: Session) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(:ns, 0)"), {"ns": _NS_SETUP})


def lock_channel_transactions(db: Session, channel_id: int) -> None:
    """Serialises batch submissions for one payment channel (duplicate check + insert)."""
    db.execute(
        text("SELECT pg_advisory_xact_lock(:ns, :channel_id)"),
        {"ns": _NS_CHANNEL_TRANSACTIONS, "channel_id": channel_id},
    )
