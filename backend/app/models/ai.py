from datetime import date, datetime
from typing import Any

from sqlalchemy import CHAR, CheckConstraint, Date, DateTime, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AiSettings(Base):
    """The OpenAI-compatible service that writes spending insights: a single row with
    `id = 1`, absent until the user first saves it.

    `api_key` is stored in plain text (accepted: single-user, LAN) and is never returned
    by any endpoint or written to a log; responses carry only whether it is set and its
    last four characters. It may be NULL for local servers that need no key.
    """

    __tablename__ = "ai_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_ai_settings_single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    base_url: Mapped[str] = mapped_column(String(500))
    model: Mapped[str] = mapped_column(String(200))
    api_key: Mapped[str | None] = mapped_column(Text)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AiInsight(Base):
    """The last insight generated for one month (`month` is its first day).

    `content` is `{lines: [{tone, text}]}` (one or two), validated before it is saved. A row
    of the earlier `{summary, month_points, year_points}` shape is read as its summary.
    `data_hash` is the SHA-256 of the input it was generated from; when the current input
    hashes differently the insight is reported as stale.
    """

    __tablename__ = "ai_insights"
    __table_args__ = (
        CheckConstraint("EXTRACT(DAY FROM month) = 1", name="ck_ai_insights_month_start"),
    )

    month: Mapped[date] = mapped_column(Date, primary_key=True)
    content: Mapped[dict[str, Any]] = mapped_column(JSONB)
    model: Mapped[str] = mapped_column(String(200))
    data_hash: Mapped[str] = mapped_column(CHAR(64))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
