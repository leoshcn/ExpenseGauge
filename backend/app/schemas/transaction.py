from datetime import date, datetime
from typing import Annotated, Any

from pydantic import Field, StringConstraints, WithJsonSchema, field_validator

from app.schemas.common import Money, NoNul, RequestSchema, Schema

MAX_BATCH_ITEMS = 500


class TransactionItemIn(RequestSchema):
    """One submitted transaction. Validated per item by the service, not by the router,
    so a bad field is reported as an `INVALID_FIELD` item instead of failing the request."""

    date: date
    amount: Money = Field(description="Expense > 0, refund < 0, never 0")
    counterparty: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NoNul
    ]
    description: Annotated[
        str, StringConstraints(strip_whitespace=True, max_length=1000), NoNul
    ] = ""
    category_id: int = Field(description="A level-2 category (any budget account)")
    note: Annotated[str, StringConstraints(max_length=1000), NoNul] | None = None
    confirm_duplicate: bool = Field(
        default=False,
        description="Single-use: set only after the user confirmed a reported duplicate is real",
    )

    @field_validator("amount")
    @classmethod
    def _non_zero(cls, value):
        if value == 0:
            raise ValueError("amount must not be 0")
        return value


# Items stay raw dicts at the HTTP/MCP boundary; the JSON schema still documents the shape.
RawTransactionItem = Annotated[
    dict[str, Any], WithJsonSchema(TransactionItemIn.model_json_schema())
]


class BatchSubmitIn(RequestSchema):
    items: list[RawTransactionItem] = Field(description=f"1 to {MAX_BATCH_ITEMS} items")


class TransactionOut(Schema):
    id: int
    channel_id: int
    channel_name: str
    category_id: int
    category_name: str
    parent_category_id: int
    parent_category_name: str
    budget_account_id: int = Field(description="Follows from the category; not stored")
    budget_account_name: str
    date: date
    amount: Money
    counterparty: str
    description: str
    note: str | None
    confirmed_duplicate: bool
    created_at: datetime


class BatchAcceptedOut(Schema):
    accepted: bool = True
    transactions: list[TransactionOut]


class TransactionPage(Schema):
    items: list[TransactionOut]
    total: int
    page: int
    page_size: int


class TransactionUpdateIn(RequestSchema):
    """Only category and note are editable. Omitted fields are left unchanged."""

    category_id: int | None = None
    note: Annotated[str, StringConstraints(max_length=1000), NoNul] | None = None
