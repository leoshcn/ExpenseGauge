from typing import Annotated

from pydantic import Field

from app.schemas.common import Money, Month, RequestSchema, Schema


class BudgetItemIn(RequestSchema):
    category_id: int
    amount: Annotated[Money, Field(ge=0)]


class BudgetsPutIn(RequestSchema):
    effective_from: Month
    items: Annotated[list[BudgetItemIn], Field(min_length=1, max_length=500)]


class BudgetLine(Schema):
    category_id: int
    category_name: str
    parent_id: int
    parent_name: str
    amount: Money | None = Field(description="Budget in force for the month; null means no budget")
    effective_from: Month | None = Field(description="Month the in-force version started")


class BudgetsOut(Schema):
    account_id: int
    currency: str
    month: Month
    budgets: list[BudgetLine]
