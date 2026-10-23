from datetime import date
from typing import Literal, Self

from pydantic import Field, model_validator

from app.schemas.common import Money, Month, Name, RequestSchema, Schema

GroupBy = Literal["level1", "level2", "counterparty", "channel", "tag"]


class ReportGroup(Schema):
    key: str | None = Field(
        description="Category or channel id, the counterparty, or the tag; null is the group"
        " of transactions without a tag"
    )
    label: str | None = Field(description="What to show; null for the no-tag group")
    amount: Money = Field(description="Net amount (payments minus refunds) in the range")
    count: int = Field(description="Consumption count: payments whose net amount is above 0")
    months: list[Money] = Field(description="Net amount per month of `months`")


class ReportTotal(Schema):
    amount: Money
    count: int
    months: list[Money]


class ReportOut(Schema):
    currency: str
    group_by: GroupBy
    months: list[Month]
    groups: list[ReportGroup] = Field(description="Largest amount first")
    total: ReportTotal = Field(
        description="Of the transactions themselves: with tags, not the sum of the groups"
    )
    overlapping: bool = Field(
        description="Some transaction has several tags and is in several groups"
    )


class DailyAmount(Schema):
    date: date
    amount: Money


class MonthBudget(Schema):
    month: Month
    budget: Money | None


class DailyOut(Schema):
    currency: str
    days: list[DailyAmount] = Field(description="Days with any spending, in order")
    budgets: list[MonthBudget] = Field(description="The scope's monthly budget per month")


RangePreset = Literal["this_month", "last_3", "last_6", "last_12", "this_year", "custom"]


class ReportRange(RequestSchema):
    preset: RangePreset
    from_month: Month | None = Field(default=None, description="Custom ranges only")
    to_month: Month | None = Field(default=None, description="Custom ranges only")

    @model_validator(mode="after")
    def _custom_has_months(self) -> Self:
        if self.preset == "custom" and (self.from_month is None or self.to_month is None):
            raise ValueError("a custom range needs from and to")
        return self


class SavedReportConfig(RequestSchema):
    """What a saved custom report remembers; the figures are computed when it is opened."""

    group_by: GroupBy
    mode: Literal["total", "monthly"]
    range: ReportRange
    budget_account_id: int | None = None
    chart: Literal["table", "bar", "line", "donut"]


class SavedReportIn(RequestSchema):
    name: Name
    config: SavedReportConfig


class SavedReportUpdateIn(RequestSchema):
    name: Name | None = None
    config: SavedReportConfig | None = None


class SavedReportOut(Schema):
    id: int
    name: str
    config: SavedReportConfig
