from pydantic import Field

from app.schemas.common import Name, Period, RequestSchema, Schema


class BudgetAccountCreateIn(RequestSchema):
    name: Name
    period: Period = Field(
        default="month",
        description="`month`: budgets per month; `year`: one budget per calendar year."
        " Cannot be changed later",
    )


class BudgetAccountUpdateIn(RequestSchema):
    """Only the name is editable; the period is fixed at creation."""

    name: Name


class BudgetAccountOut(Schema):
    id: int
    name: str
    period: Period
