"""Budgets: one amount per level-2 category, in force from a month until the next version.

A version whose amount is NULL clears the budget: from its month on the category has
"no budget", exactly as if it never had one. Amount 0 is a real budget.
"""

from bisect import bisect_right
from datetime import date
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import Budget, Category
from app.months import format_month, parse_month
from app.schemas.budget import BudgetItemIn, BudgetLine, BudgetsOut
from app.services.accounts import get_account
from app.services.categories import load_categories


class BudgetHistory:
    """All budget versions of one account; the single place that resolves "in force"."""

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


def load_history(db: Session, account_id: int) -> BudgetHistory:
    rows = db.scalars(
        select(Budget)
        .join(Category, Budget.category_id == Category.id)
        .where(Category.account_id == account_id)
    )
    return BudgetHistory(list(rows))


def get_budgets(db: Session, account_id: int, month: str | None) -> BudgetsOut:
    """Budget in force per level-2 category for `month` (default: the current month)."""
    account = get_account(db, account_id)
    month_date = parse_month(month) if month else date.today().replace(day=1)
    categories = load_categories(db, account_id)
    names = {c.id: c.name for c in categories}
    history = load_history(db, account_id)
    lines = []
    for category in categories:
        if category.parent_id is None:
            continue
        row = history.in_force(category.id, month_date)
        lines.append(
            BudgetLine(
                category_id=category.id,
                category_name=category.name,
                parent_id=category.parent_id,
                parent_name=names[category.parent_id],
                amount=row.amount if row else None,
                effective_from=format_month(row.effective_from) if row else None,
            )
        )
    return BudgetsOut(
        account_id=account_id,
        currency=account.currency,
        month=format_month(month_date),
        budgets=lines,
    )


def set_budgets(
    db: Session, account_id: int, effective_from: str, items: list[BudgetItemIn]
) -> BudgetsOut:
    """Upserts one budget version per item at `effective_from`; all items or none.

    An item with amount None clears the budget from that month. Afterwards each touched
    category's clearing versions with no budget in force before them are removed
    (`_drop_redundant_clears`), in the same transaction.
    """
    get_account(db, account_id)
    month_date = parse_month(effective_from)
    categories = {c.id: c for c in load_categories(db, account_id)}
    seen: set[int] = set()
    for item in items:
        details = {"category_id": item.category_id}
        category = categories.get(item.category_id)
        if category is None:
            raise invalid("CATEGORY_NOT_FOUND", "分类不存在或不属于该账户", details)
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
        statement = insert(Budget).values(
            category_id=item.category_id, effective_from=month_date, amount=item.amount
        )
        db.execute(
            statement.on_conflict_do_update(
                constraint="uq_budgets_category_effective_from",
                set_={"amount": statement.excluded.amount},
            )
        )
    _drop_redundant_clears(db, seen)
    db.commit()
    return get_budgets(db, account_id, effective_from)


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
