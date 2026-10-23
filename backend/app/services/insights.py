"""AI spending insights for one month of the Dashboard's "全部" view.

`build_input` gathers what the model is given, from the same services the Dashboard
reads (so the figures agree): the month detail, the 12-month trend ending at the month,
the annual budget accounts year to date, and the month's transactions without note,
channel or any id. `generate` sends it to the configured OpenAI-compatible service and
stores the validated answer per month; a failure leaves the stored insight untouched.
`get_state` only reads: it never calls the model.

An insight is stale when the SHA-256 of the current input differs from the one it was
generated from, i.e. the month's data changed. Today's date and the time progress are in
the prompt but not in the hash, and neither are the model or the prompt.
"""

import calendar
import hashlib
import json
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.errors import invalid
from app.models import AiInsight, Transaction
from app.months import add_months, format_month, parse_month
from app.schemas.ai import InsightContent, InsightOut, InsightStateOut
from app.schemas.summary import Level1Row, Level2Row
from app.services import ai_client
from app.services.ai_settings import is_configured, require_config
from app.services.categories import load_categories
from app.services.refunds import effective_category, join_payment, refunded_amounts
from app.services.settings import require_currency
from app.services.summaries import get_annual_summary, get_month_detail, get_monthly_summary

TREND_MONTHS = 12
MAX_TRANSACTIONS = 1000
CENT = Decimal("0.01")
ZERO = Decimal("0.00")

SYSTEM_PROMPT = "\n".join(
    [
        "你是一位个人财务分析师。用户会给你一份 JSON 格式的消费数据，"
        "请分析所选月份以及该月所在年份年初至今的消费情况。",
        "",
        "数据说明：",
        "- 所有金额都是字符串，单位是 currency 指定的币种。预算为 null 表示未设预算，不是 0。",
        "- month_detail：所选月份的月度预算账户的预算、实际支出、消费笔数和一二级分类明细。"
        "annual_actual 是年度预算账户在当月的支出，不计入月度预算对比。"
        "带 rollover_carry_in 的二级分类开启了结余结转：rollover_carry_in 是之前月份留下的结余"
        "（负数为累计超支），rollover_available 是本月还可用的金额，小于 0 即超支。",
        "- trend：截至所选月份的近 12 个月月度预算与实际支出。",
        "- annual_accounts：各年度预算账户从 1 月到所选月份的全年预算、"
        "年初至今支出、笔数和逐月支出。",
        "- transactions：所选月份的流水。金额为负的是退款（refund 为 true）；"
        "refunded 是已匹配到这笔支付的退款合计。total 是当月流水总笔数；"
        "如果 included 小于 total，items 只包含金额绝对值最大的 included 笔。",
        "",
        "要求：",
        "- 只使用给出的数据，不要编造；结论要具体，引用金额、比例、分类名称或交易对方，"
        "不要泛泛的理财建议。",
        "- 如果所选月份是当前月份，要结合时间进度判断（例如月中已用 80% 的预算属于偏快）。",
        "- month_points 是关于所选月份的要点，year_points 是关于年初至今"
        "（趋势和年度预算账户）的要点，各 2 到 5 条。",
        "- tone 取值：warning 表示超支、异常或需要注意；positive 表示低于预算或有所改善；"
        "neutral 表示其他客观情况。",
        "- 使用简体中文。",
        "- 只输出一个 JSON 对象，不要输出任何其他文字，格式如下：",
        '{"summary": "一句话总结", "month_points": [{"tone": "warning", "text": "……"}], '
        '"year_points": [{"tone": "positive", "text": "……"}]}',
    ]
)


def _money(value: Decimal | None) -> str | None:
    return None if value is None else str(value.quantize(CENT))


def _row(row: Level1Row | Level2Row) -> dict[str, Any]:
    fields: dict[str, Any] = {
        "name": row.name,
        "budget": _money(row.budget),
        "actual": _money(row.actual),
        "count": row.count,
    }
    if isinstance(row, Level2Row) and row.carry_in is not None:
        # A rollover category: earlier months' leftover (or overspending) carries in.
        fields["rollover_carry_in"] = _money(row.carry_in)
        fields["rollover_available"] = _money(row.carry_in + (row.budget or ZERO) - row.actual)
    return fields


def _transactions(db: Session, start: date) -> dict[str, Any]:
    """The month's transactions (by their own date), at most `MAX_TRANSACTIONS` of the
    largest absolute amounts, sorted by date. A matched refund shows its payment's
    category, as everywhere else."""
    categories = {c.id: c for c in load_categories(db)}
    rows = db.execute(
        join_payment(select(Transaction, effective_category)).where(
            Transaction.date >= start, Transaction.date < add_months(start, 1)
        )
    ).all()
    total = len(rows)
    if total > MAX_TRANSACTIONS:
        rows = sorted(rows, key=lambda r: (-abs(r[0].amount), r[0].id))[:MAX_TRANSACTIONS]
    rows = sorted(rows, key=lambda r: (r[0].date, r[0].id))
    refunded = refunded_amounts(db, {t.id for t, _ in rows if t.amount > 0})

    def category_name(category_id: int) -> str:
        leaf = categories[category_id]
        parent = categories.get(leaf.parent_id) if leaf.parent_id is not None else None
        return f"{parent.name}/{leaf.name}" if parent else leaf.name

    return {
        "total": total,
        "included": len(rows),
        "items": [
            {
                "date": t.date.isoformat(),
                "amount": _money(t.amount),
                "category": category_name(category_id),
                "counterparty": t.counterparty,
                "description": t.description,
                "refund": t.amount < 0,
                "refunded": _money(refunded.get(t.id)),
            }
            for t, category_id in rows
        ],
    }


def build_input(db: Session, start: date) -> dict[str, Any]:
    """What the model is given about month `start` (also what the staleness hash covers)."""
    month = format_month(start)
    currency = require_currency(db)
    detail = get_month_detail(db, month)
    trend = get_monthly_summary(db, format_month(add_months(start, -(TREND_MONTHS - 1))), month)
    annual = get_annual_summary(db, month)
    return {
        "currency": currency,
        "month": month,
        "month_detail": {
            "budget": _money(detail.budget),
            "actual": _money(detail.actual),
            "count": detail.count,
            "annual_actual": _money(detail.annual_actual),
            "categories": [
                {**_row(row), "children": [_row(child) for child in row.children]}
                for row in detail.categories
            ],
        },
        "trend": [
            {
                "month": point.month,
                "budget": _money(point.budget),
                "actual": _money(point.actual),
                "annual_actual": _money(point.annual_actual),
            }
            for point in trend.months
        ],
        "annual_accounts": [
            {
                "name": account.name,
                "budget": _money(account.budget),
                "actual": _money(account.actual),
                "count": account.count,
                "months": [{"month": m.month, "actual": _money(m.actual)} for m in account.months],
            }
            for account in annual.accounts
        ],
        "transactions": _transactions(db, start),
    }


def _canonical(data: dict[str, Any]) -> str:
    return json.dumps(data, sort_keys=True, ensure_ascii=False)


def data_hash(data: dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(data).encode()).hexdigest()


def _progress(start: date, today: date) -> str:
    if start == today.replace(day=1):
        days = calendar.monthrange(today.year, today.month)[1]
        return (
            f"所选月份是当前月份，已过 {today.day}/{days} 天（{today.day * 100 // days}%），"
            "当月数据还不完整。"
        )
    return "所选月份已经结束。"


def build_messages(data: dict[str, Any], today: date) -> list[dict[str, str]]:
    start = parse_month(data["month"])
    user = f"今天是 {today.isoformat()}。{_progress(start, today)}\n\n数据：\n{_canonical(data)}"
    return [{"role": "system", "content": SYSTEM_PROMPT}, {"role": "user", "content": user}]


def _month(month: str) -> date:
    """The first day of `month`, which may not be after the current month."""
    start = parse_month(month)
    if start > date.today().replace(day=1):
        raise invalid("INVALID_MONTH", "不能分析未来的月份", {"value": month})
    return start


def _out(row: AiInsight) -> InsightOut:
    return InsightOut(**row.content, model=row.model, generated_at=row.generated_at)


def get_state(db: Session, month: str) -> InsightStateOut:
    """The month's cached insight and whether its data changed since. Never calls the model."""
    start = _month(month)
    row = db.get(AiInsight, start)
    stale = row is not None and row.data_hash != data_hash(build_input(db, start))
    return InsightStateOut(
        month=format_month(start),
        configured=is_configured(db),
        insight=_out(row) if row is not None else None,
        stale=stale,
    )


def generate(db: Session, month: str) -> InsightStateOut:
    """Asks the model about `month` and stores the answer, replacing the month's previous
    insight only once the new one is valid."""
    start = _month(month)
    config = require_config(db)
    data = build_input(db, start)
    messages = build_messages(data, date.today())
    # End the read transaction: the model may take minutes and no row is held meanwhile.
    db.rollback()

    parsed = ai_client.parse_json_content(ai_client.chat(config, messages))
    try:
        content = InsightContent.model_validate(parsed)
    except ValidationError:
        raise ai_client.invalid_response("schema") from None

    values = {
        "content": content.model_dump(mode="json"),
        "model": config.model,
        "data_hash": data_hash(data),
        "generated_at": datetime.now(UTC),
    }
    statement = insert(AiInsight).values(month=start, **values)
    db.execute(
        statement.on_conflict_do_update(
            index_elements=[AiInsight.month],
            set_={name: statement.excluded[name] for name in values},
        )
    )
    db.commit()
    return InsightStateOut(
        month=format_month(start),
        configured=True,
        insight=InsightOut(
            **values["content"], model=config.model, generated_at=values["generated_at"]
        ),
        stale=False,
    )
