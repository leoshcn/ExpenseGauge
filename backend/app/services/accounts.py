from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import conflict, not_found
from app.models import Account


def get_account(db: Session, account_id: int) -> Account:
    account = get_by_id(db, Account, account_id)
    if account is None:
        raise not_found("ACCOUNT_NOT_FOUND", "账户不存在")
    return account


def list_accounts(db: Session) -> list[Account]:
    return list(db.scalars(select(Account).order_by(Account.id)))


def _commit_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("ACCOUNT_NAME_TAKEN", "已存在同名账户") from exc


def create_account(db: Session, name: str, currency: str) -> Account:
    account = Account(name=name, currency=currency.upper())
    db.add(account)
    _commit_name(db)
    return account


def rename_account(db: Session, account_id: int, name: str) -> Account:
    account = get_account(db, account_id)
    account.name = name
    _commit_name(db)
    return account
