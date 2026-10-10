from typing import Annotated

from pydantic import StringConstraints

from app.schemas.common import Name, RequestSchema, Schema

Currency = Annotated[
    str, StringConstraints(strip_whitespace=True, to_upper=True, pattern=r"^[A-Za-z]{3}$")
]


class AccountCreateIn(RequestSchema):
    name: Name
    currency: Currency


class AccountUpdateIn(RequestSchema):
    name: Name


class AccountOut(Schema):
    id: int
    name: str
    currency: str
