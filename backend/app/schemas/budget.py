from typing import Annotated

from pydantic import Field

from app.schemas.common import Money, Month, Period, RequestSchema, Schema


class BudgetItemIn(RequestSchema):
    category_id: int
    amount: Annotated[Money, Field(ge=0)] | None = Field(
        description="Budget from `effective_from` on; null clears it (no budget) from that month"
    )


class BudgetsPutIn(RequestSchema):
    effective_from: Month = Field(
        description="First month of the new versions. A category of an annual budget account"
        " gets its version at January of this month's year (one version per year)"
    )
    items: Annotated[list[BudgetItemIn], Field(min_length=1, max_length=500)]


class BudgetLine(Schema):
    category_id: int
    category_name: str
    parent_id: int
    parent_name: str
    budget_account_id: int
    budget_account_name: str
    period: Period = Field(
        description="Period of the budget account: `month` (amount per month) or `year`"
        " (amount for the whole calendar year)"
    )
    amount: Money | None = Field(
        description="Budget in force for the month; null means no budget (never set, or"
        " cleared). For `period: year` it is the amount for the whole year"
    )
    effective_from: Month | None = Field(
        description="Month the in-force amount started (`YYYY-01` for an annual budget);"
        " null when there is no budget"
    )


class BudgetsOut(Schema):
    budget_account_id: int | None = Field(
        description="The budget account the lines were filtered by; null for all"
    )
    currency: str
    month: Month
    budgets: list[BudgetLine]
