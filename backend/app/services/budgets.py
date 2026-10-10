"""Budgets: one amount per level-2 category, in force from a month until the next version."""

from bisect import bisect_right
from datetime import date
from decimal import Decimal

from sqlalchemy import select
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
        """The version with the greatest effective_from <= month, or None for "no budget"."""
        months = self._months.get(category_id)
        if not months:
            return None
        position = bisect_right(months, month)
        return self._rows[category_id][position - 1] if position else None

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
    """Upserts one budget version per item at `effective_from`; all items or none."""
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
    db.commit()
    return get_budgets(db, account_id, effective_from)
