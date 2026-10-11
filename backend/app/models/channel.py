from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PaymentChannel(Base):
    """Where a transaction came from (a card, a statement). Used for provenance and as
    the scope of the duplicate check; never for budgets or summaries."""

    __tablename__ = "payment_channels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
