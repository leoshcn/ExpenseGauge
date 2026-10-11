"""Budget accounts: the budget pools level-2 categories belong to. No delete."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import AppError, conflict
from app.models import BudgetAccount


def get_budget_account(
    db: Session, budget_account_id: int, status_code: int = 404
) -> BudgetAccount:
    """404 when the budget account is the URL's resource; pass 422 when the id is a value
    inside the request (body or query)."""
    budget_account = get_by_id(db, BudgetAccount, budget_account_id)
    if budget_account is None:
        raise AppError(
            status_code,
            "BUDGET_ACCOUNT_NOT_FOUND",
            "预算账户不存在",
            {"budget_account_id": budget_account_id} if status_code != 404 else None,
        )
    return budget_account


def list_budget_accounts(db: Session) -> list[BudgetAccount]:
    return list(db.scalars(select(BudgetAccount).order_by(BudgetAccount.id)))


def budget_accounts_by_id(db: Session) -> dict[int, BudgetAccount]:
    return {row.id: row for row in list_budget_accounts(db)}


def _commit_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("BUDGET_ACCOUNT_NAME_TAKEN", "已存在同名预算账户") from exc


def create_budget_account(db: Session, name: str, period: str = "month") -> BudgetAccount:
    """`period` (`month` / `year`) is fixed from here on; only the name can change."""
    budget_account = BudgetAccount(name=name, period=period)
    db.add(budget_account)
    _commit_name(db)
    return budget_account


def rename_budget_account(db: Session, budget_account_id: int, name: str) -> BudgetAccount:
    budget_account = get_budget_account(db, budget_account_id)
    budget_account.name = name
    _commit_name(db)
    return budget_account
