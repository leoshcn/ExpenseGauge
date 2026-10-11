"""Dashboard figures: budget vs. actual per month and per category.

Scope is either everything (`budget_account_id` None) or one budget account. A
transaction counts where its category belongs, whichever payment channel it came from.

Monthly and annual budget accounts are never mixed in one comparison. The month views
(`get_monthly_summary`, `get_month_detail`) compare monthly budgets with the actuals of
monthly accounts' categories and report annual accounts' spending apart, as
`annual_actual`. Annual accounts are compared year to date by `get_annual_summary`.
"""

from datetime import date
from decimal import Decimal

from sqlalchemy import Date, cast, func, select
from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import BudgetAccount, Category, Transaction
from app.months import add_months, format_month, months_between, parse_month
from app.schemas.summary import (
    AnnualAccount,
    AnnualMonth,
    AnnualSummaryOut,
    Level1Row,
    Level2Row,
    MonthDetailOut,
    MonthlySummaryOut,
    MonthTotal,
)
from app.services.budget_accounts import budget_accounts_by_id, get_budget_account
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


def _split_by_period(db: Session, categories: list[Category]) -> tuple[list[int], list[int]]:
    """Level-2 ids of `categories` in monthly budget accounts, and in annual ones."""
    periods = {row.id: row.period for row in budget_accounts_by_id(db).values()}
    monthly: list[int] = []
    annual: list[int] = []
    for c in categories:
        if c.parent_id is not None:
            (annual if periods[c.budget_account_id] == "year" else monthly).append(c.id)
    return monthly, annual


def get_monthly_summary(
    db: Session,
    from_month: str | None,
    to_month: str | None,
    budget_account_id: int | None = None,
) -> MonthlySummaryOut:
    """Total budget and total actual per month, inclusive; defaults to the last 12 months.

    `budget` and `actual` cover the monthly accounts' categories in scope; the annual
    accounts' spending of the month is `annual_actual`.
    """
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
    monthly_ids, annual_ids = _split_by_period(db, categories)
    month_column = cast(func.date_trunc("month", Transaction.date), Date)
    annual_set = set(annual_ids)
    actuals: dict[date, Decimal] = {}
    annual_actuals: dict[date, Decimal] = {}
    for month, category_id, amount in db.execute(
        select(month_column, Transaction.category_id, func.sum(Transaction.amount))
        .where(
            Transaction.category_id.in_(monthly_ids + annual_ids),
            Transaction.date >= start,
            Transaction.date < add_months(end, 1),
        )
        .group_by(month_column, Transaction.category_id)
    ):
        target = annual_actuals if category_id in annual_set else actuals
        target[month] = target.get(month, ZERO) + amount
    return MonthlySummaryOut(
        budget_account_id=budget_account_id,
        currency=currency,
        months=[
            MonthTotal(
                month=format_month(month),
                budget=_sum_or_none([history.amount(leaf_id, month) for leaf_id in monthly_ids]),
                actual=actuals.get(month, ZERO),
                annual_actual=annual_actuals.get(month, ZERO),
            )
            for month in months
        ],
    )


def get_month_detail(
    db: Session, month: str, budget_account_id: int | None = None
) -> MonthDetailOut:
    """Level-1 rows with nested level-2 rows for one month. Refunds reduce actuals.

    Only monthly accounts' level-2 categories appear (annual ones are summed into
    `annual_actual`). For one budget account its level-2 categories appear under their
    level-1 parents; for everything, every level-1 category does that has a monthly
    child or no child at all (one whose children are all annual is left out).
    """
    start = parse_month(month)
    currency, categories, history = _scope(db, budget_account_id)
    monthly_ids, annual_ids = _split_by_period(db, categories)
    annual_set = set(annual_ids)
    actuals = dict(
        db.execute(
            select(Transaction.category_id, func.sum(Transaction.amount))
            .where(
                Transaction.category_id.in_(monthly_ids + annual_ids),
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
    annual_parents: set[int] = set()
    for c in categories:
        if c.parent_id is None:
            continue
        if c.id in annual_set:
            annual_parents.add(c.parent_id)
            continue
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

    level1 = [row for row in rows.values() if row.children or row.category_id not in annual_parents]
    return MonthDetailOut(
        budget_account_id=budget_account_id,
        currency=currency,
        month=format_month(start),
        budget=_sum_or_none([row.budget for row in level1]),
        actual=sum((row.actual for row in level1), ZERO),
        annual_actual=sum((actuals.get(leaf_id, ZERO) for leaf_id in annual_ids), ZERO),
        categories=level1,
    )


def get_annual_summary(
    db: Session, month: str, budget_account_id: int | None = None
) -> AnnualSummaryOut:
    """Year to date for annual budget accounts: January to the end of `month`.

    Every annual budget account (none: an empty list), or only `budget_account_id`,
    which must be annual (else 422 `NOT_ANNUAL_ACCOUNT`). Budgets are the versions in
    force for `month`, i.e. that year's (annual versions start in January).
    """
    through = parse_month(month)
    year_start = date(through.year, 1, 1)
    if budget_account_id is not None:
        account = get_budget_account(db, budget_account_id, status_code=422)
        if account.period != "year":
            raise invalid(
                "NOT_ANNUAL_ACCOUNT",
                "该预算账户是月度账户，没有年度汇总",
                {"budget_account_id": budget_account_id},
            )
        accounts = [account]
    else:
        accounts = [a for a in budget_accounts_by_id(db).values() if a.period == "year"]
    currency = require_currency(db)

    categories = load_categories(db)
    account_ids = {a.id for a in accounts}
    leaf_ids = [c.id for c in categories if c.budget_account_id in account_ids]
    history = load_history(db)
    month_column = cast(func.date_trunc("month", Transaction.date), Date)
    actuals: dict[tuple[int, date], Decimal] = {
        (category_id, month_start): amount
        for category_id, month_start, amount in db.execute(
            select(Transaction.category_id, month_column, func.sum(Transaction.amount))
            .where(
                Transaction.category_id.in_(leaf_ids),
                Transaction.date >= year_start,
                Transaction.date < add_months(through, 1),
            )
            .group_by(Transaction.category_id, month_column)
        )
    }
    months = months_between(year_start, through)
    return AnnualSummaryOut(
        currency=currency,
        year=through.year,
        through=format_month(through),
        accounts=[
            _annual_account(account, categories, history, actuals, months) for account in accounts
        ],
    )


def _annual_account(
    account: BudgetAccount,
    categories: list[Category],
    history: BudgetHistory,
    actuals: dict[tuple[int, date], Decimal],
    months: list[date],
) -> AnnualAccount:
    leaves = [c for c in categories if c.budget_account_id == account.id]
    parent_ids = {c.parent_id for c in leaves}
    rows: dict[int, Level1Row] = {
        c.id: Level1Row(category_id=c.id, name=c.name, budget=None, actual=ZERO, children=[])
        for c in categories
        if c.id in parent_ids
    }
    through = months[-1]
    for c in leaves:
        rows[c.parent_id].children.append(
            Level2Row(
                category_id=c.id,
                name=c.name,
                budget=history.amount(c.id, through),
                actual=sum((actuals.get((c.id, m), ZERO) for m in months), ZERO),
            )
        )
    for row in rows.values():
        row.budget = _sum_or_none([child.budget for child in row.children])
        row.actual = sum((child.actual for child in row.children), ZERO)
    level1 = list(rows.values())
    return AnnualAccount(
        budget_account_id=account.id,
        name=account.name,
        budget=_sum_or_none([row.budget for row in level1]),
        actual=sum((row.actual for row in level1), ZERO),
        months=[
            AnnualMonth(
                month=format_month(m),
                actual=sum((actuals.get((c.id, m), ZERO) for c in leaves), ZERO),
            )
            for m in months
        ],
        categories=level1,
    )
