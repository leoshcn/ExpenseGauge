"""Dashboard figures: budget vs. actual per month and per category.

Scope is either everything (`budget_account_id` None) or one budget account. A
transaction counts where its category belongs, whichever payment channel it came from.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import Category, Transaction
from app.months import add_months, format_month, months_between, parse_month
from app.schemas.summary import Level1Row, Level2Row, MonthDetailOut, MonthlySummaryOut, MonthTotal
from app.services.budget_accounts import get_budget_account
from app.services.budgets import BudgetHistory, load_history
from app.services.categories import load_categories
from app.services.settings import require_currency

DEFAULT_MONTHS = 12
MAX_MONTHS = 60
ZERO = Decimal("0.00")


def _sum_or_none(amounts: list[Decimal | None]) -> Decimal | None:
    """Sum of the known budgets; None when there is none at all ("no budget")."""
    known = [amount for amount in amounts if amount is not None]
    return sum(known, ZERO) if known else None


def _scope(db: Session, budget_account_id: int | None) -> tuple[str, list[Category], BudgetHistory]:
    """Currency, the categories in scope (level 2 plus their level 1) and their budgets."""
    if budget_account_id is not None:
        get_budget_account(db, budget_account_id, status_code=422)
    currency = require_currency(db)
    return currency, load_categories(db, budget_account_id), load_history(db, budget_account_id)


def get_monthly_summary(
    db: Session,
    from_month: str | None,
    to_month: str | None,
    budget_account_id: int | None = None,
) -> MonthlySummaryOut:
    """Total budget and total actual per month, inclusive; defaults to the last 12 months."""
    end = parse_month(to_month) if to_month else date.today().replace(day=1)
    start = parse_month(from_month) if from_month else add_months(end, -(DEFAULT_MONTHS - 1))
    months = months_between(start, end)
    if not months or len(months) > MAX_MONTHS:
        raise invalid(
            "INVALID_MONTH_RANGE",
            f"月份范围无效：from 不能晚于 to，且最多 {MAX_MONTHS} 个月",
            {"from": format_month(start), "to": format_month(end)},
        )

    currency, categories, history = _scope(db, budget_account_id)
    leaf_ids = [c.id for c in categories if c.parent_id is not None]
    month_column = cast(func.date_trunc("month", Transaction.date), Date)
    actuals = {
        row[0]: row[1]
        for row in db.execute(
            select(month_column, func.sum(Transaction.amount))
            .where(
                Transaction.category_id.in_(leaf_ids),
                Transaction.date >= start,
                Transaction.date < add_months(end, 1),
            )
            .group_by(month_column)
        )
    }
    return MonthlySummaryOut(
        budget_account_id=budget_account_id,
        currency=currency,
        months=[
            MonthTotal(
                month=format_month(month),
                budget=_sum_or_none([history.amount(leaf_id, month) for leaf_id in leaf_ids]),
                actual=actuals.get(month, ZERO),
            )
            for month in months
        ],
    )


def get_month_detail(
    db: Session, month: str, budget_account_id: int | None = None
) -> MonthDetailOut:
    """Level-1 rows with nested level-2 rows for one month. Refunds reduce actuals.

    For one budget account only its level-2 categories appear, under their level-1
    parents; for everything, every level-1 category does (also one without children).
    """
    start = parse_month(month)
    currency, categories, history = _scope(db, budget_account_id)
    leaf_ids = [c.id for c in categories if c.parent_id is not None]
    actuals = dict(
        db.execute(
            select(Transaction.category_id, func.sum(Transaction.amount))
            .where(
                Transaction.category_id.in_(leaf_ids),
                Transaction.date >= start,
                Transaction.date < add_months(start, 1),
            )
            .group_by(Transaction.category_id)
        ).all()
    )

    rows: dict[int, Level1Row] = {
        c.id: Level1Row(category_id=c.id, name=c.name, budget=None, actual=ZERO, children=[])
        for c in categories
        if c.parent_id is None
    }
    for c in categories:
        if c.parent_id is not None:
            rows[c.parent_id].children.append(
                Level2Row(
                    category_id=c.id,
                    name=c.name,
                    budget=history.amount(c.id, start),
                    actual=actuals.get(c.id, ZERO),
                )
            )
    for row in rows.values():
        row.budget = _sum_or_none([child.budget for child in row.children])
        row.actual = sum((child.actual for child in row.children), ZERO)

    level1 = list(rows.values())
    return MonthDetailOut(
        budget_account_id=budget_account_id,
        currency=currency,
        month=format_month(start),
        budget=_sum_or_none([row.budget for row in level1]),
        actual=sum((row.actual for row in level1), ZERO),
        categories=level1,
    )
