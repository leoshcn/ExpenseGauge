from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import Field, StringConstraints, WithJsonSchema, field_validator, model_validator

from app.schemas.common import Money, NoNul, RequestSchema, Schema

MAX_BATCH_ITEMS = 500
MAX_PAYMENT_SEARCH_DAYS = 366
MAX_PAYMENT_SEARCH_LIMIT = 50
MAX_RECATEGORIZE_ITEMS = 100
MAX_REASON_LENGTH = 200
MAX_NOTE_LENGTH = 1000

TransactionKind = Literal["payment", "refund"]


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
    note: Annotated[str, StringConstraints(max_length=MAX_NOTE_LENGTH), NoNul] | None = None
    confirm_duplicate: bool = Field(
        default=False,
        description="Single-use: set only after the user confirmed a reported duplicate is real",
    )
    refund_of_id: int | None = Field(
        default=None,
        description="Refunds only: id of the stored payment this refund reverses (from the"
        " payment search). Not together with `refund_of_index`",
    )
    refund_of_index: int | None = Field(
        default=None,
        description="Refunds only: index, in this batch, of the payment item this refund"
        " reverses. Not together with `refund_of_id`",
    )

    @field_validator("amount")
    @classmethod
    def _non_zero(cls, value):
        if value == 0:
            raise ValueError("amount must not be 0")
        return value

    @model_validator(mode="after")
    def _one_refund_target(self):
        if self.refund_of_id is not None and self.refund_of_index is not None:
            raise ValueError("refund_of_id and refund_of_index are mutually exclusive")
        return self


# Items stay raw dicts at the HTTP/MCP boundary; the JSON schema still documents the shape.
RawTransactionItem = Annotated[
    dict[str, Any], WithJsonSchema(TransactionItemIn.model_json_schema())
]


class BatchSubmitIn(RequestSchema):
    items: list[RawTransactionItem] = Field(description=f"1 to {MAX_BATCH_ITEMS} items")


class RefundTarget(Schema):
    """The payment a matched refund reverses."""

    id: int
    date: date
    amount: Money
    counterparty: str
    category_name: str


class TransactionOut(Schema):
    id: int
    channel_id: int
    channel_name: str
    category_id: int = Field(
        description="For a matched refund: the category of its payment (where it counts),"
        " not the one it was submitted with"
    )
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
    refund_of: RefundTarget | None = Field(
        description="The payment this refund is matched to; null for a payment and for an"
        " unmatched refund"
    )
    refunded: Money = Field(
        description="Total of the refunds matched to this payment, as a positive amount;"
        ' "0.00" for a refund'
    )
    created_at: datetime


class BatchAcceptedOut(Schema):
    accepted: bool = True
    transactions: list[TransactionOut]


class TransactionStats(Schema):
    """Figures for the list's filters, by effective attribution (a matched refund counts
    in its payment's month, category and channel), like the summaries."""

    count: int = Field(description="Payments whose net amount (after matched refunds) is above 0")
    net_amount: Money = Field(description="Payments minus refunds")


class TransactionPage(Schema):
    items: list[TransactionOut]
    total: int
    page: int
    page_size: int
    stats: TransactionStats


class RefundCandidatePage(Schema):
    """Payments a refund can be matched to, best guesses first."""

    items: list[TransactionOut]
    total: int
    page: int
    page_size: int


class TransactionUpdateIn(RequestSchema):
    """Category, note and (for a refund) the matched payment are editable. Omitted fields
    are left unchanged."""

    category_id: int | None = None
    note: Annotated[str, StringConstraints(max_length=MAX_NOTE_LENGTH), NoNul] | None = None
    refund_of_id: int | None = Field(
        default=None,
        description="Refunds only: the payment to match (or re-match) this refund to;"
        " null removes the match",
    )


class PaymentOut(Schema):
    """A stored payment, as much of it as finding a refund's original payment needs."""

    id: int
    channel_id: int
    channel_name: str
    date: date
    amount: Money
    counterparty: str
    description: str
    category_id: int
    category_name: str
    refunded: Money = Field(description="Total of the refunds already matched to it (positive)")
    refundable: Money = Field(description="`amount - refunded`: what a new refund may not exceed")


class PaymentSearchOut(Schema):
    payments: list[PaymentOut] = Field(description="Newest first")


class TransactionSearchOut(Schema):
    transactions: list[TransactionOut] = Field(description="Newest first")


class RecategorizeItemIn(RequestSchema):
    """One category change by an agent. Validated per item by the service, like a batch
    item, so a bad field is reported as an `INVALID_FIELD` item."""

    transaction_id: int
    category_id: int = Field(description="The new level-2 category")
    reason: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=MAX_REASON_LENGTH),
        NoNul,
    ] = Field(description="Why the category is changed; appended to the transaction's note")


RawRecategorizeItem = Annotated[
    dict[str, Any], WithJsonSchema(RecategorizeItemIn.model_json_schema())
]


class RecategorizeIn(RequestSchema):
    items: list[RawRecategorizeItem] = Field(description=f"1 to {MAX_RECATEGORIZE_ITEMS} items")


class RecategorizeAcceptedOut(Schema):
    accepted: bool = True
    transactions: list[TransactionOut]


MAX_BULK_ITEMS = 500
MAX_SEARCH_TEXT = 100

Note = Annotated[str, StringConstraints(max_length=MAX_NOTE_LENGTH), NoNul]


class BulkUpdateItemIn(RequestSchema):
    """One transaction's new category and/or note. Fields absent are unchanged; `note: null`
    removes the note. Nothing is appended to the note (unlike an agent's recategorize)."""

    transaction_id: int
    category_id: int | None = None
    note: Note | None = None

    @model_validator(mode="after")
    def _changes_something(self) -> "BulkUpdateItemIn":
        if not self.model_fields_set & {"category_id", "note"}:
            raise ValueError("category_id or note is required")
        if "category_id" in self.model_fields_set and self.category_id is None:
            raise ValueError("category_id cannot be null")
        return self


class BulkUpdateIn(RequestSchema):
    items: Annotated[list[BulkUpdateItemIn], Field(min_length=1, max_length=MAX_BULK_ITEMS)]


class BulkUpdateOut(Schema):
    transactions: list[TransactionOut] = Field(description="In the order of the request")


class TransactionIdsIn(RequestSchema):
    ids: Annotated[list[int], Field(min_length=1, max_length=MAX_BULK_ITEMS)]


class RestoreOut(Schema):
    transactions: list[TransactionOut] = Field(description="The restored rows, by id")


class TagCount(Schema):
    tag: str = Field(description="Without the `#`")
    count: int = Field(description="Transactions whose note has the tag")


class TagRenameIn(RequestSchema):
    from_tag: Annotated[str, StringConstraints(min_length=1, max_length=50), NoNul]
    to_tag: Annotated[str, StringConstraints(min_length=1, max_length=50), NoNul]


class NoteChange(Schema):
    transaction_id: int
    note_before: str = Field(description="The note before the rename, to undo it")


class TagRenameOut(Schema):
    changed: list[NoteChange]
