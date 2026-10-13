from pydantic import Field

from app.schemas.common import Money, Month, Schema


class MonthTotal(Schema):
    month: Month
    budget: Money | None = Field(
        description="Sum of monthly budgets in force; null if no category has one"
    )
    actual: Money = Field(description="Actual of the monthly budget accounts' categories")
    annual_actual: Money = Field(
        description="Actual of the annual budget accounts' categories in the month; not"
        " included in `actual`"
    )


class MonthlySummaryOut(Schema):
    budget_account_id: int | None = Field(
        description="The budget account the figures are for; null for all of them"
    )
    currency: str
    months: list[MonthTotal]


class Level2Row(Schema):
    category_id: int
    name: str
    budget: Money | None = Field(description="null means no budget")
    actual: Money
    count: int = Field(
        description="Payments counted here whose net amount (after matched refunds) is above 0"
    )


class Level1Row(Schema):
    category_id: int
    name: str
    budget: Money | None = Field(description="Sum of the children's budgets; null if none has one")
    actual: Money
    count: int = Field(description="Sum of the children's counts")
    children: list[Level2Row]


class MonthDetailOut(Schema):
    budget_account_id: int | None = Field(
        description="The budget account the figures are for; null for all of them"
    )
    currency: str
    month: Month
    budget: Money | None
    actual: Money = Field(description="Actual of the monthly budget accounts' categories")
    count: int = Field(
        description="Consumption count over the same categories as `actual`: payments of the"
        " month whose net amount (after matched refunds) is above 0"
    )
    annual_actual: Money = Field(
        description="Actual of the annual budget accounts' categories in the month; they are"
        " in neither `actual`, `count` nor `categories`"
    )
    categories: list[Level1Row]


class AnnualMonth(Schema):
    month: Month
    actual: Money


class AnnualAccount(Schema):
    budget_account_id: int
    name: str
    budget: Money | None = Field(
        description="Sum of the year's budgets of its categories; null if none has one"
    )
    actual: Money = Field(description="Actual from January to the end of `through`")
    count: int = Field(description="Consumption count from January to the end of `through`")
    months: list[AnnualMonth] = Field(description="January to `through`, one entry per month")
    categories: list[Level1Row] = Field(
        description="Rows with the annual budget and the year-to-date actual"
    )


class AnnualSummaryOut(Schema):
    currency: str
    year: int
    through: Month = Field(description="Last month included (year to date)")
    accounts: list[AnnualAccount]
