"""Reports: spending grouped by category, counterparty, channel or tag over a range of
months; daily spending; saved custom reports.

Every figure uses the effective attribution of `services/refunds.py`: a matched refund
counts with its payment (month, day, category, channel, counterparty and note, hence
tags). A payment is a consumption (`count`) while its net amount after all its matched
refunds is above zero, in its own month, exactly as `effective_totals` counts. Grouping by
level-2 category therefore gives the summaries' figures. Rows are aggregated in Python;
the range is at most `MAX_MONTHS`.
"""

from collections import defaultdict
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import conflict, invalid, not_found
from app.models import Category, SavedReport, Transaction
from app.months import add_months, format_month, months_between, parse_month
from app.schemas.report import (
    DailyAmount,
    DailyOut,
    GroupBy,
    MonthBudget,
    ReportGroup,
    ReportOut,
    ReportTotal,
    SavedReportConfig,
    SavedReportOut,
)
from app.services.budget_accounts import budget_accounts_by_id, get_budget_account
from app.services.budgets import load_history
from app.services.categories import load_categories
from app.services.channels import channel_names
from app.services.refunds import (
    effective_category,
    effective_channel,
    effective_date,
    effective_note,
    join_payment,
    payment,
    refunded_amounts,
)
from app.services.settings import require_currency
from app.tags import parse_tags

MAX_MONTHS = 60
ZERO = Decimal("0.00")

effective_counterparty = case(
    (Transaction.refund_of_id.is_not(None), payment.counterparty), else_=Transaction.counterparty
)


@dataclass(frozen=True)
class _Row:
    id: int
    amount: Decimal
    is_payment: bool
    month: date
    day: date
    category_id: int
    channel_id: int
    counterparty: str
    note: str | None


def _range(from_month: str, to_month: str) -> list[date]:
    start, end = parse_month(from_month), parse_month(to_month)
    months = months_between(start, end)
    if not months or len(months) > MAX_MONTHS:
        raise invalid(
            "INVALID_MONTH_RANGE",
            f"月份范围无效：起始月不能晚于结束月，且最多 {MAX_MONTHS} 个月",
            {"from": from_month, "to": to_month},
        )
    return months


def _leaves(db: Session, budget_account_id: int | None, monthly_only: bool) -> list[Category]:
    """The level-2 categories in scope: one budget account's, or all (only monthly
    accounts' when `monthly_only`, as the dashboard's "全部")."""
    if budget_account_id is not None:
        get_budget_account(db, budget_account_id, status_code=422)
    periods = {a.id: a.period for a in budget_accounts_by_id(db).values()}
    skip_annual = budget_account_id is None and monthly_only
    return [
        c
        for c in load_categories(db, budget_account_id)
        if c.parent_id is not None and not (skip_annual and periods[c.budget_account_id] == "year")
    ]


def _rows(db: Session, leaf_ids: list[int], start: date, end: date) -> list[_Row]:
    """Every transaction counting in `[start, end)` in those categories, by effective
    attribution."""
    month = cast(func.date_trunc("month", effective_date), Date)
    statement = join_payment(
        select(
            Transaction.id,
            Transaction.amount,
            month,
            effective_date,
            effective_category,
            effective_channel,
            effective_counterparty,
            effective_note,
        )
    ).where(effective_category.in_(leaf_ids), effective_date >= start, effective_date < end)
    return [
        _Row(row_id, amount, amount > 0, m, day, category_id, channel_id, counterparty, note)
        for row_id, amount, m, day, category_id, channel_id, counterparty, note in db.execute(
            statement
        ).all()
    ]


def summarize(
    db: Session,
    group_by: GroupBy,
    from_month: str,
    to_month: str,
    budget_account_id: int | None = None,
) -> ReportOut:
    """Net amount and consumption count per group and per month. "All" includes annual
    budget accounts (a report is about spending, not about one budget)."""
    months = _range(from_month, to_month)
    currency = require_currency(db)
    leaves = _leaves(db, budget_account_id, monthly_only=False)
    rows = _rows(db, [c.id for c in leaves], months[0], add_months(months[-1], 1))
    categories = {c.id: c for c in load_categories(db)}
    channels = channel_names(db)
    refunded = refunded_amounts(db, {row.id for row in rows if row.is_payment})
    index = {m: i for i, m in enumerate(months)}

    def keys_of(row: _Row) -> list[tuple[str | None, str | None]]:
        category = categories[row.category_id]
        if group_by == "level2":
            return [(str(category.id), category.name)]
        if group_by == "level1":
            assert category.parent_id is not None
            parent = categories[category.parent_id]
            return [(str(parent.id), parent.name)]
        if group_by == "channel":
            return [(str(row.channel_id), channels[row.channel_id])]
        if group_by == "counterparty":
            return [(row.counterparty, row.counterparty)]
        return [(tag, tag) for tag in parse_tags(row.note)] or [(None, None)]

    amounts: dict[str | None, list[Decimal]] = defaultdict(lambda: [ZERO] * len(months))
    counts: dict[str | None, int] = defaultdict(int)
    labels: dict[str | None, str | None] = {}
    total = [ZERO] * len(months)
    total_count = 0
    overlapping = False
    for row in rows:
        keys = keys_of(row)
        overlapping = overlapping or len(keys) > 1
        counted = row.is_payment and row.amount - refunded.get(row.id, ZERO) > 0
        slot = index[row.month]
        total[slot] += row.amount
        total_count += counted
        for key, label in keys:
            amounts[key][slot] += row.amount
            counts[key] += counted
            labels[key] = label

    groups = [
        ReportGroup(
            key=key,
            label=labels[key],
            amount=sum(series, ZERO),
            count=counts[key],
            months=series,
        )
        for key, series in amounts.items()
    ]
    groups.sort(key=lambda g: (-g.amount, g.label is None, g.label or ""))
    return ReportOut(
        currency=currency,
        group_by=group_by,
        months=[format_month(m) for m in months],
        groups=groups,
        total=ReportTotal(amount=sum(total, ZERO), count=total_count, months=total),
        overlapping=overlapping,
    )


def daily(
    db: Session, from_month: str, to_month: str, budget_account_id: int | None = None
) -> DailyOut:
    """Net amount per day (effective day) and the monthly budget per month, for "全部"
    (monthly budget accounts only, as the dashboard) or one budget account."""
    months = _range(from_month, to_month)
    currency = require_currency(db)
    leaves = _leaves(db, budget_account_id, monthly_only=True)
    rows = _rows(db, [c.id for c in leaves], months[0], add_months(months[-1], 1))
    by_day: dict[date, Decimal] = defaultdict(lambda: ZERO)
    for row in rows:
        by_day[row.day] += row.amount
    history = load_history(db, budget_account_id)

    def budget(month: date) -> Decimal | None:
        known = [a for c in leaves if (a := history.amount(c.id, month)) is not None]
        return sum(known, ZERO) if known else None

    return DailyOut(
        currency=currency,
        days=[DailyAmount(date=day, amount=amount) for day, amount in sorted(by_day.items())],
        budgets=[MonthBudget(month=format_month(m), budget=budget(m)) for m in months],
    )


def _out(report: SavedReport) -> SavedReportOut:
    return SavedReportOut(
        id=report.id, name=report.name, config=SavedReportConfig.model_validate(report.config)
    )


def _get(db: Session, report_id: int) -> SavedReport:
    report = get_by_id(db, SavedReport, report_id)
    if report is None:
        raise not_found("REPORT_NOT_FOUND", "报表不存在")
    return report


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("REPORT_NAME_TAKEN", "已有同名报表") from exc


def list_saved(db: Session) -> list[SavedReportOut]:
    return [_out(r) for r in db.scalars(select(SavedReport).order_by(SavedReport.name))]


def save(db: Session, name: str, config: SavedReportConfig) -> SavedReportOut:
    report = SavedReport(name=name, config=config.model_dump(mode="json"))
    db.add(report)
    _commit(db)
    return _out(report)


def update_saved(
    db: Session, report_id: int, name: str | None, config: SavedReportConfig | None
) -> SavedReportOut:
    report = _get(db, report_id)
    if name is not None:
        report.name = name
    if config is not None:
        report.config = config.model_dump(mode="json")
    _commit(db)
    return _out(report)


def delete_saved(db: Session, report_id: int) -> None:
    db.delete(_get(db, report_id))
    db.commit()
