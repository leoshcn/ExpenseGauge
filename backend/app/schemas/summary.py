from pydantic import Field

from app.schemas.common import Money, Month, Schema


class MonthTotal(Schema):
    month: Month
    budget: Money | None = Field(description="Sum of budgets in force; null if no category has one")
    actual: Money


class MonthlySummaryOut(Schema):
    account_id: int
    currency: str
    months: list[MonthTotal]


class Level2Row(Schema):
    category_id: int
    name: str
    budget: Money | None = Field(description="null means no budget")
    actual: Money


class Level1Row(Schema):
    category_id: int
    name: str
    budget: Money | None = Field(description="Sum of the children's budgets; null if none has one")
    actual: Money
    children: list[Level2Row]


class MonthDetailOut(Schema):
    account_id: int
    currency: str
    month: Month
    budget: Money | None
    actual: Money
    categories: list[Level1Row]
