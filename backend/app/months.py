"""Month handling. A month travels over the API as `YYYY-MM` and is stored as its first day."""

import re
from datetime import date

from app.errors import invalid

MONTH_PATTERN = r"^\d{4}-(0[1-9]|1[0-2])$"
_MONTH_RE = re.compile(MONTH_PATTERN)


def parse_month(value: str) -> date:
    if not isinstance(value, str) or not _MONTH_RE.match(value) or value.startswith("0000"):
        raise invalid("INVALID_MONTH", "月份格式应为 YYYY-MM", {"value": value})
    return date(int(value[:4]), int(value[5:7]), 1)


def format_month(value: date) -> str:
    return f"{value.year:04d}-{value.month:02d}"


def month_start(value: date) -> date:
    return value.replace(day=1)


def add_months(value: date, count: int) -> date:
    index = value.year * 12 + (value.month - 1) + count
    if not date.min.year * 12 <= index < (date.max.year + 1) * 12:
        raise invalid("INVALID_MONTH", "月份超出支持的范围", {"value": format_month(value)})
    return date(index // 12, index % 12 + 1, 1)


def months_between(start: date, end: date) -> list[date]:
    """Inclusive list of month starts from `start` to `end`."""
    result = []
    current = month_start(start)
    while current <= end:
        result.append(current)
        current = add_months(current, 1)
    return result
