from datetime import datetime
from typing import Annotated

from pydantic import StringConstraints

from app.schemas.common import Name, NoNul, RequestSchema, Schema

Username = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64), NoNul
]
Password = Annotated[str, StringConstraints(min_length=8, max_length=200)]


class SetupStatus(Schema):
    user_exists: bool


class CredentialsIn(RequestSchema):
    username: Username
    password: Password


class LoginIn(RequestSchema):
    username: Annotated[str, NoNul]
    password: str


class UserOut(Schema):
    id: int
    username: str
    created_at: datetime


class TokenCreateIn(RequestSchema):
    name: Name


class TokenOut(Schema):
    id: int
    name: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class TokenCreatedOut(TokenOut):
    """Returned once, at creation. `token` is never retrievable afterwards."""

    token: str
