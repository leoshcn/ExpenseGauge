"""Scheduled (recurring) expenses: what the user expects to pay, whether this period's
payment has arrived, the month's forecast, and candidates found in the history.

A schedule never creates a transaction. A period is paid when a stored payment
(amount > 0) dated within `WINDOW_DAYS` of the due date has the keyword in its
counterparty or description (case-insensitive) and the amount (equal, or within
`APPROXIMATE` when the schedule is approximate). Each payment pays at most one schedule.
"""

import calendar
from collections import Counter, defaultdict
from datetime import date, timedelta
from decimal import Decimal
from statistics import median
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import invalid, not_found
from app.models import Category, Schedule, Transaction
from app.months import add_months, format_month, parse_month
from app.schemas.schedule import (
    ScheduleForecast,
    ScheduleOut,
    ScheduleStatusItem,
    ScheduleStatusOut,
    ScheduleSuggestion,
)
from app.services.budget_accounts import budget_accounts_by_id, get_budget_account
from app.services.categories import load_categories
from app.services.summaries import get_month_detail
from app.services.transactions import describe, normalize_text

WINDOW_DAYS = 3
APPROXIMATE = Decimal("0.075")
SUGGESTION_MONTHS = 6
SUGGESTION_MIN_MONTHS = 3
SUGGESTION_DAY_SPREAD = 5
CENT = Decimal("0.01")
ZERO = Decimal("0.00")


def _today() -> date:
    """Today; tests replace it."""
    return date.today()


def _outs(db: Session, rows: list[Schedule]) -> list[ScheduleOut]:
    categories = {c.id: c for c in load_categories(db)}
    accounts = budget_accounts_by_id(db)
    outs = []
    for row in rows:
        category = categories[row.category_id]
        assert category.parent_id is not None and category.budget_account_id is not None
        account = accounts[category.budget_account_id]
        outs.append(
            ScheduleOut(
                id=row.id,
                name=row.name,
                keyword=row.keyword,
                category_id=category.id,
                category_name=category.name,
                parent_category_name=categories[category.parent_id].name,
                budget_account_id=account.id,
                budget_account_name=account.name,
                amount=row.amount,
                approximate=row.approximate,
                frequency=row.frequency,  # type: ignore[arg-type]
                day=row.day,
                month_of_year=row.month_of_year,
                start_month=row.start_month,  # type: ignore[arg-type]
                active=row.active,
            )
        )
    return outs


def _get(db: Session, schedule_id: int) -> Schedule:
    row = get_by_id(db, Schedule, schedule_id)
    if row is None:
        raise not_found("SCHEDULE_NOT_FOUND", "定期支出不存在")
    return row


def _check(db: Session, fields: dict[str, Any]) -> None:
    """Rules on the resulting row: a level-2 category, and `month_of_year` iff yearly."""
    category = get_by_id(db, Category, fields["category_id"])
    details = {"category_id": fields["category_id"]}
    if category is None:
        raise invalid("CATEGORY_NOT_FOUND", "分类不存在", details)
    if category.parent_id is None:
        raise invalid("CATEGORY_NOT_LEAF", "定期支出只能归入二级分类", details)
    yearly = fields["frequency"] == "year"
    if yearly != (fields["month_of_year"] is not None):
        raise invalid(
            "INVALID_SCHEDULE",
            "每年的定期支出需要选择月份，每月的不需要",
            {"frequency": fields["frequency"], "month_of_year": fields["month_of_year"]},
        )


def list_schedules(db: Session) -> list[ScheduleOut]:
    rows = list(db.scalars(select(Schedule).order_by(Schedule.active.desc(), Schedule.id)))
    return _outs(db, rows)


def create_schedule(db: Session, fields: dict[str, Any]) -> ScheduleOut:
    fields = {**fields}
    fields["start_month"] = (
        parse_month(fields["start_month"]) if fields.get("start_month") else _today().replace(day=1)
    )
    _check(db, fields)
    row = Schedule(**fields)
    db.add(row)
    db.commit()
    return _outs(db, [row])[0]


def update_schedule(db: Session, schedule_id: int, changes: dict[str, Any]) -> ScheduleOut:
    row = _get(db, schedule_id)
    if "start_month" in changes:
        changes = {**changes, "start_month": parse_month(changes["start_month"])}
    if changes.get("frequency") == "month" and "month_of_year" not in changes:
        changes = {**changes, "month_of_year": None}
    merged = {
        "category_id": row.category_id,
        "frequency": row.frequency,
        "month_of_year": row.month_of_year,
        **changes,
    }
    _check(db, merged)
    for key, value in changes.items():
        setattr(row, key, value)
    db.commit()
    return _outs(db, [row])[0]


def delete_schedule(db: Session, schedule_id: int) -> None:
    db.delete(_get(db, schedule_id))
    db.commit()


def due_date(schedule: Schedule, month: date) -> date | None:
    """When `schedule` is due in `month` (first day), or None when it is not due then."""
    if not schedule.active or schedule.start_month > month:
        return None
    if schedule.frequency == "year" and schedule.month_of_year != month.month:
        return None
    last = calendar.monthrange(month.year, month.month)[1]
    day = last if schedule.day == -1 else min(schedule.day, last)
    return month.replace(day=day)


def _amount_matches(schedule: Schedule, amount: Decimal) -> bool:
    if not schedule.approximate:
        return amount == schedule.amount
    return abs(amount - schedule.amount) <= schedule.amount * APPROXIMATE


def _matches(schedule: Schedule, payment: Transaction) -> bool:
    keyword = normalize_text(schedule.keyword)
    text = f"{normalize_text(payment.counterparty)} {normalize_text(payment.description)}"
    return keyword in text and _amount_matches(schedule, payment.amount)


def get_status(db: Session, month: str, budget_account_id: int | None = None) -> ScheduleStatusOut:
    """The schedules due in `month` (in the scope's budget account, or all), each paid,
    pending or overdue; with the forecast when `month` is the current month."""
    start = parse_month(month)
    if budget_account_id is not None:
        get_budget_account(db, budget_account_id, status_code=422)
    categories = {c.id: c for c in load_categories(db)}
    accounts = budget_accounts_by_id(db)
    schedules = [
        row
        for row in db.scalars(select(Schedule).order_by(Schedule.id))
        if budget_account_id is None
        or categories[row.category_id].budget_account_id == budget_account_id
    ]
    due = {row.id: d for row in schedules if (d := due_date(row, start)) is not None}
    schedules = [row for row in schedules if row.id in due]

    payments: list[Transaction] = []
    if due:
        window = timedelta(days=WINDOW_DAYS)
        payments = list(
            db.scalars(
                select(Transaction).where(
                    Transaction.amount > 0,
                    Transaction.date >= min(due.values()) - window,
                    Transaction.date <= max(due.values()) + window,
                )
            )
        )

    # Exact schedules choose first, then by due date: each takes the closest unclaimed match.
    claimed: dict[int, Transaction] = {}
    taken: set[int] = set()
    for row in sorted(schedules, key=lambda r: (r.approximate, due[r.id], r.id)):
        candidates = [
            p
            for p in payments
            if p.id not in taken
            and abs((p.date - due[row.id]).days) <= WINDOW_DAYS
            and _matches(row, p)
        ]
        if candidates:
            best = min(
                candidates,
                key=lambda p: (abs((p.date - due[row.id]).days), abs(p.amount - row.amount), p.id),
            )
            claimed[row.id] = best
            taken.add(best.id)

    today = _today()
    outs = {out.id: out for out in _outs(db, schedules)}
    described = {t.id: t for t in describe(db, list(claimed.values()))}
    items = []
    for row in schedules:
        payment = claimed.get(row.id)
        if payment is not None:
            status = "paid"
        elif today <= due[row.id] + timedelta(days=WINDOW_DAYS):
            status = "pending"
        else:
            status = "overdue"
        items.append(
            ScheduleStatusItem(
                schedule=outs[row.id],
                due_date=due[row.id],
                status=status,  # type: ignore[arg-type]
                transaction=described[payment.id] if payment is not None else None,
            )
        )
    order = {"overdue": 0, "pending": 1, "paid": 2}
    items.sort(key=lambda item: (order[item.status], item.due_date, item.schedule.id))

    forecast = None
    if start == today.replace(day=1):
        actual = get_month_detail(db, month, budget_account_id).actual
        outstanding = sum(
            (
                item.schedule.amount
                for item in items
                if item.status != "paid"
                and accounts[categories[item.schedule.category_id].budget_account_id].period
                == "month"
            ),
            ZERO,
        )
        forecast = ScheduleForecast(
            actual=actual, outstanding=outstanding, projected=actual + outstanding
        )
    return ScheduleStatusOut(month=format_month(start), items=items, forecast=forecast)


def suggestions(db: Session) -> list[ScheduleSuggestion]:
    """Payments that look recurring: the same counterparty in at least
    `SUGGESTION_MIN_MONTHS` of the last `SUGGESTION_MONTHS` months, every amount within 7.5%
    of their median, on days of the month at most `SUGGESTION_DAY_SPREAD` apart. Those an
    existing schedule's keyword already covers are left out. Largest first."""
    today = _today()
    start = add_months(today.replace(day=1), -(SUGGESTION_MONTHS - 1))
    payments = list(
        db.scalars(
            select(Transaction)
            .where(Transaction.amount > 0, Transaction.date >= start, Transaction.date <= today)
            .order_by(Transaction.date)
        )
    )
    keywords = [normalize_text(row.keyword) for row in db.scalars(select(Schedule))]
    categories = {c.id: c for c in load_categories(db)}
    groups: dict[str, list[Transaction]] = defaultdict(list)
    for payment in payments:
        groups[normalize_text(payment.counterparty)].append(payment)

    found = []
    for key, rows in groups.items():
        months = {(row.date.year, row.date.month) for row in rows}
        if len(months) < SUGGESTION_MIN_MONTHS or any(k and k in key for k in keywords):
            continue
        # One payment per month: the one closest to the typical amount.
        middle = Decimal(str(median(row.amount for row in rows)))
        per_month: dict[tuple[int, int], Transaction] = {}
        for row in rows:
            slot = (row.date.year, row.date.month)
            current = per_month.get(slot)
            if current is None or abs(row.amount - middle) < abs(current.amount - middle):
                per_month[slot] = row
        picked = list(per_month.values())
        amounts = [row.amount for row in picked]
        typical = Decimal(str(median(amounts))).quantize(CENT)
        if any(abs(amount - typical) > typical * APPROXIMATE for amount in amounts):
            continue
        days = [row.date.day for row in picked]
        if max(days) - min(days) > SUGGESTION_DAY_SPREAD:
            continue
        latest = picked[-1]
        category_id = Counter(row.category_id for row in picked).most_common(1)[0][0]
        found.append(
            ScheduleSuggestion(
                name=latest.counterparty,
                keyword=latest.counterparty,
                category_id=category_id,
                category_name=categories[category_id].name,
                amount=typical,
                approximate=len(set(amounts)) > 1,
                day=round(median(days)),
                months=len(picked),
            )
        )
    found.sort(key=lambda s: (-s.amount, s.name))
    return found
