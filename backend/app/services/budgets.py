"""Budgets: one amount per level-2 category, in force from a month until the next version.

A version whose amount is NULL clears the budget: from its month on the category has
"no budget", exactly as if it never had one. Amount 0 is a real budget.

A budget belongs to its category, and through it to the category's current budget
account: moving a category to another budget account of the same period moves its whole
history (D4); a move to the other period resets it (`services/categories.py`).

In an annual budget account (`period == "year"`) a version is the amount for a whole
calendar year and always starts in January: `set_budgets` stores it at January 1 of the
requested month's year, so `in_force` returns that year's version for any of its months.
"""

from bisect import bisect_right
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import Budget, Category
from app.months import add_months, format_month, parse_month
from app.schemas.budget import BudgetItemIn, BudgetLine, BudgetsOut
from app.services.budget_accounts import budget_accounts_by_id, get_budget_account
from app.services.categories import load_categories
from app.services.refunds import effective_totals
from app.services.settings import require_currency

REFERENCE_MONTHS = 3
CENT = Decimal("0.01")
ZERO = Decimal("0.00")


class BudgetHistory:
    """Budget versions of a set of categories; the single place that resolves "in force"."""

    def __init__(self, rows: list[Budget]) -> None:
        self._months: dict[int, list[date]] = {}
        self._rows: dict[int, list[Budget]] = {}
        for row in sorted(rows, key=lambda r: r.effective_from):
            self._months.setdefault(row.category_id, []).append(row.effective_from)
            self._rows.setdefault(row.category_id, []).append(row)

    def in_force(self, category_id: int, month: date) -> Budget | None:
        """The version with the greatest effective_from <= month. None for "no budget":
        there is no such version, or it is a cleared one (NULL amount)."""
        return self._budgeted(category_id, bisect_right, month)

    def _budgeted(self, category_id: int, bisect, month: date) -> Budget | None:
        position = bisect(self._months.get(category_id, []), month)
        row = self._rows[category_id][position - 1] if position else None
        return row if row is not None and row.amount is not None else None

    def amount(self, category_id: int, month: date) -> Decimal | None:
        row = self.in_force(category_id, month)
        return row.amount if row else None


def load_history(db: Session, budget_account_id: int | None = None) -> BudgetHistory:
    """Every budget version, or those of the level-2 categories that currently belong to
    one budget account."""
    statement = select(Budget)
    if budget_account_id is not None:
        statement = statement.join(Category, Budget.category_id == Category.id).where(
            Category.budget_account_id == budget_account_id
        )
    return BudgetHistory(list(db.scalars(statement)))


def get_budgets(db: Session, month: str | None, budget_account_id: int | None = None) -> BudgetsOut:
    """Budget in force per level-2 category for `month` (default: the current month), for
    every level-2 category or only those of one budget account, with what it spent before
    (`reference_last`, `reference_avg3`) and, for a rollover category, its carry-in."""
    from app.services.rollover import carry_ins

    if budget_account_id is not None:
        get_budget_account(db, budget_account_id, status_code=422)
    currency = require_currency(db)
    month_date = parse_month(month) if month else date.today().replace(day=1)
    categories = load_categories(db, budget_account_id)
    names = {c.id: c.name for c in categories}
    budget_accounts = budget_accounts_by_id(db)
    history = load_history(db, budget_account_id)
    leaves = [c for c in categories if c.parent_id is not None]
    last_year = date(month_date.year - 1, 1, 1)
    window = min(add_months(month_date, -REFERENCE_MONTHS), last_year)
    actuals = effective_totals(
        db, category_ids=[c.id for c in leaves], start=window, end=month_date
    )
    carries = carry_ins(
        db,
        [c for c in leaves if budget_accounts[c.budget_account_id].period == "month"],
        history,
        month_date,
    )

    def actual(category_id: int, start: date, end: date) -> Decimal:
        return sum(
            (
                total.amount
                for (m, leaf_id), total in actuals.items()
                if leaf_id == category_id and start <= m < end
            ),
            ZERO,
        )

    lines = []
    for category in leaves:
        row = history.in_force(category.id, month_date)
        budget_account = budget_accounts[category.budget_account_id]
        annual = budget_account.period == "year"
        if annual:
            reference_last = actual(category.id, last_year, date(month_date.year, 1, 1))
            reference_avg3 = None
        else:
            reference_last = actual(category.id, add_months(month_date, -1), month_date)
            reference_avg3 = (
                actual(category.id, add_months(month_date, -REFERENCE_MONTHS), month_date)
                / REFERENCE_MONTHS
            ).quantize(CENT, ROUND_HALF_UP)
        lines.append(
            BudgetLine(
                category_id=category.id,
                category_name=category.name,
                parent_id=category.parent_id,
                parent_name=names[category.parent_id],
                budget_account_id=budget_account.id,
                budget_account_name=budget_account.name,
                period=budget_account.period,
                amount=row.amount if row else None,
                effective_from=format_month(row.effective_from) if row else None,
                reference_last=reference_last,
                reference_avg3=reference_avg3,
                rollover_from=format_month(category.rollover_from)
                if category.rollover_from
                else None,
                carry_in=carries.get(category.id),
            )
        )
    return BudgetsOut(
        budget_account_id=budget_account_id,
        currency=currency,
        month=format_month(month_date),
        budgets=lines,
    )


def set_budgets(db: Session, effective_from: str, items: list[BudgetItemIn]) -> BudgetsOut:
    """Upserts one budget version per item at `effective_from`; all items or none.

    Any level-2 category may be in the request, whatever its budget account. A category
    of an annual budget account gets its version at January of `effective_from`'s year
    instead, so a year has a single version and saving it mid-year rewrites that one;
    one request may mix monthly and annual categories. An item with amount None clears
    the budget from that version's month. Afterwards each touched category's clearing
    versions with no budget in force before them are removed (`_drop_redundant_clears`),
    in the same transaction. Returns every budget line of the month.
    """
    require_currency(db)  # the response reports it: fail before writing anything
    month_date = parse_month(effective_from)
    year_start = date(month_date.year, 1, 1)
    periods = {row.id: row.period for row in budget_accounts_by_id(db).values()}
    categories = {c.id: c for c in load_categories(db)}
    seen: set[int] = set()
    for item in items:
        details = {"category_id": item.category_id}
        category = categories.get(item.category_id)
        if category is None:
            raise invalid("CATEGORY_NOT_FOUND", "分类不存在", details)
        if category.parent_id is None:
            raise invalid(
                "CATEGORY_NOT_LEAF",
                "预算只能设置在二级分类上，一级分类预算为其下二级分类之和",
                details,
            )
        if item.category_id in seen:
            raise invalid("DUPLICATE_CATEGORY", "同一分类在请求中出现多次", details)
        seen.add(item.category_id)
    for item in items:
        annual = periods[categories[item.category_id].budget_account_id] == "year"
        statement = insert(Budget).values(
            category_id=item.category_id,
            effective_from=year_start if annual else month_date,
            amount=item.amount,
        )
        db.execute(
            statement.on_conflict_do_update(
                constraint="uq_budgets_category_effective_from",
                set_={"amount": statement.excluded.amount},
            )
        )
    _drop_redundant_clears(db, seen)
    db.commit()
    return get_budgets(db, effective_from)


def _drop_redundant_clears(db: Session, category_ids: set[int]) -> None:
    """Deletes clearing versions (NULL amount) that have no budget in force before them.

    Walking each category's versions by month, a NULL row is kept only when the previous
    kept row has an amount; one with no earlier row, or following another NULL row, clears
    nothing. So consecutive clears collapse to the first, and a later set never stops at a
    stale clear left behind when the budget before it was removed.
    """
    if not category_ids:
        return
    rows = db.execute(
        select(Budget.id, Budget.category_id, Budget.amount)
        .where(Budget.category_id.in_(category_ids))
        .order_by(Budget.category_id, Budget.effective_from)
    )
    redundant: list[int] = []
    budgeted: dict[int, bool] = {}
    for row_id, category_id, amount in rows:
        if amount is None and not budgeted.get(category_id, False):
            redundant.append(row_id)
        else:
            budgeted[category_id] = amount is not None
    if redundant:
        db.execute(delete(Budget).where(Budget.id.in_(redundant)))
