from typing import Annotated

from pydantic import Field, StringConstraints

from app.schemas.common import RequestSchema, Schema

Currency = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")
]


class SettingsOut(Schema):
    currency: str | None = Field(
        description="Base currency (ISO 4217) of every amount; null until onboarding sets it"
    )


class SettingsUpdateIn(RequestSchema):
    """Changing the currency only relabels amounts; nothing is converted."""

    currency: Currency
