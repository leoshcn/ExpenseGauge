"""Rollover: a level-2 category of a monthly budget account whose unspent budget, or
overspending, carries into the next month (`categories.rollover_from`).

From its `rollover_from` month on, the category's carry-in for a month is the sum over the
earlier months of (budget, or 0 when it has none) minus the actual. Both directions carry:
a month spent over its budget leaves less for the next one. Months before
`rollover_from` do not count; turning rollover off and on again starts from zero. Actuals
are the summaries' (`refunds.effective_totals`).
"""

from datetime import date
from decimal import Decimal

from sqlalchemy.orm import Session

from app.models import Category
from app.months import add_months, months_between
from app.services.budgets import BudgetHistory
from app.services.refunds import NO_TOTALS, effective_totals

ZERO = Decimal("0.00")


def carry_ins(
    db: Session, categories: list[Category], history: BudgetHistory, month: date
) -> dict[int, Decimal]:
    """The carry-in at `month` of each of `categories` whose rollover has started by then
    (`rollover_from <= month`); others are absent. `history` must hold their budgets."""
    rolling = [c for c in categories if c.rollover_from is not None and c.rollover_from <= month]
    if not rolling:
        return {}
    start = min(c.rollover_from for c in rolling if c.rollover_from is not None)
    totals = (
        effective_totals(db, category_ids=[c.id for c in rolling], start=start, end=month)
        if start < month
        else {}
    )
    result: dict[int, Decimal] = {}
    for category in rolling:
        assert category.rollover_from is not None
        carry = ZERO
        if category.rollover_from < month:
            for m in months_between(category.rollover_from, add_months(month, -1)):
                budget = history.amount(category.id, m) or ZERO
                carry += budget - totals.get((m, category.id), NO_TOTALS).amount
        result[category.id] = carry
    return result
