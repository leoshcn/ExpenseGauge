from sqlalchemy import CHAR, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class AppSettings(Base):
    """Ledger-wide settings: a single row with `id = 1`, absent until onboarding sets it.

    `currency` is the base currency every amount is in. Changing it only relabels
    amounts; nothing is converted.
    """

    __tablename__ = "app_settings"
    __table_args__ = (CheckConstraint("id = 1", name="ck_app_settings_single_row"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=False)
    currency: Mapped[str] = mapped_column(CHAR(3))
