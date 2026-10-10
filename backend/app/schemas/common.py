from decimal import Decimal
from typing import Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, StringConstraints

from app.months import MONTH_PATTERN


def _no_nul(value: str) -> str:
    if "\x00" in value:
        raise ValueError("must not contain the NUL character")
    return value


# PostgreSQL text cannot hold U+0000, so every stored string is checked on the way in;
# otherwise the INSERT fails and the caller gets a 500 instead of a validation error.
NoNul = AfterValidator(_no_nul)

# `YYYY-MM`
Month = Annotated[str, StringConstraints(pattern=MONTH_PATTERN)]
# Money is NUMERIC(14,2) in the database and a decimal string ("12.30") in JSON.
Money = Annotated[Decimal, Field(max_digits=14, decimal_places=2)]
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NoNul]


class Schema(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class RequestSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")
