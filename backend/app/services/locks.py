"""PostgreSQL advisory locks, held until the surrounding database transaction ends."""

from sqlalchemy import text
from sqlalchemy.orm import Session

# First key of the two-int advisory lock: one namespace per purpose.
_NS_SETUP = 1001
_NS_ACCOUNT_TRANSACTIONS = 1002


def lock_setup(db: Session) -> None:
    db.execute(text("SELECT pg_advisory_xact_lock(:ns, 0)"), {"ns": _NS_SETUP})


def lock_account_transactions(db: Session, account_id: int) -> None:
    """Serialises batch submissions for one account (duplicate check + insert)."""
    db.execute(
        text("SELECT pg_advisory_xact_lock(:ns, :account_id)"),
        {"ns": _NS_ACCOUNT_TRANSACTIONS, "account_id": account_id},
    )
