from datetime import date
from typing import Annotated, Literal, Self

from pydantic import Field, StringConstraints, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.months import format_month
from app.schemas.common import Money, Month, Name, NoNul, RequestSchema, Schema
from app.schemas.transaction import TransactionOut

Frequency = Literal["month", "year"]
Keyword = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100), NoNul
]
Day = Annotated[int, Field(ge=-1, le=31, description="Day of the month, or -1 for the last day")]
MonthOfYear = Annotated[int, Field(ge=1, le=12)]
PositiveMoney = Annotated[Money, Field(gt=0)]


class ScheduleCreateIn(RequestSchema):
    name: Name
    keyword: Keyword = Field(description="Matched in a payment's counterparty or description")
    category_id: int = Field(description="A level-2 category")
    amount: PositiveMoney
    approximate: bool = Field(default=False, description="Within 7.5% of `amount`")
    frequency: Frequency = "month"
    day: Day
    month_of_year: MonthOfYear | None = Field(
        default=None, description="Required for `frequency: year`, refused otherwise"
    )
    start_month: Month | None = Field(default=None, description="Default: the current month")
    active: bool = True


class ScheduleUpdateIn(RequestSchema):
    """Partial update: fields left out keep their value."""

    name: Name | SkipJsonSchema[None] = None
    keyword: Keyword | SkipJsonSchema[None] = None
    category_id: int | SkipJsonSchema[None] = None
    amount: PositiveMoney | SkipJsonSchema[None] = None
    approximate: bool | SkipJsonSchema[None] = None
    frequency: Frequency | SkipJsonSchema[None] = None
    day: Day | SkipJsonSchema[None] = None
    month_of_year: MonthOfYear | None = None
    start_month: Month | SkipJsonSchema[None] = None
    active: bool | SkipJsonSchema[None] = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one field is required")
        for field in self.model_fields_set - {"month_of_year"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class ScheduleOut(Schema):
    id: int
    name: str
    keyword: str
    category_id: int
    category_name: str
    parent_category_name: str
    budget_account_id: int
    budget_account_name: str
    amount: Money
    approximate: bool
    frequency: Frequency
    day: int
    month_of_year: int | None
    start_month: Month
    active: bool

    @field_validator("start_month", mode="before")
    @classmethod
    def _month(cls, value: date | str) -> str:
        return format_month(value) if isinstance(value, date) else value


ScheduleState = Literal["paid", "pending", "overdue"]


class ScheduleStatusItem(Schema):
    schedule: ScheduleOut
    due_date: date
    status: ScheduleState = Field(
        description="`paid`: a matching payment was found; `pending`: not yet, and the due"
        " date is less than 3 days ago; `overdue`: none 3 days after the due date"
    )
    transaction: TransactionOut | None = Field(description="The matching payment, when paid")


class ScheduleForecast(Schema):
    actual: Money = Field(description="The month's actual, as the month detail of the scope")
    outstanding: Money = Field(
        description="Expected amounts of the pending and overdue schedules of monthly budget"
        " accounts in the scope"
    )
    projected: Money = Field(description="`actual + outstanding`")


class ScheduleStatusOut(Schema):
    month: Month
    items: list[ScheduleStatusItem] = Field(description="Overdue first, then by due date")
    forecast: ScheduleForecast | None = Field(description="Only for the current month")


class ScheduleSuggestion(Schema):
    name: str
    keyword: str
    category_id: int
    category_name: str
    amount: Money
    approximate: bool
    day: int
    months: int = Field(description="How many of the recent months it was paid in")
