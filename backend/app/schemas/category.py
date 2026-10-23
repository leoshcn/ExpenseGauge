from datetime import date
from typing import Annotated, Self

from pydantic import Field, field_validator, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.months import format_month
from app.schemas.budget_account import BudgetAccountOut
from app.schemas.common import Description, Money, Month, Name, RequestSchema, Schema


class CategoryCreateIn(RequestSchema):
    name: Name
    parent_id: int | None = None
    # Level 2 only; a non-blank description on a level-1 category is refused.
    description: Description | None = None
    budget_account_id: int | None = Field(
        default=None, description="Required for a level-2 category; refused on level 1"
    )


class CategoryUpdateIn(RequestSchema):
    """Partial update: fields left out keep their value. `description` null or blank clears it.

    `budget_account_id` (level 2 only) moves the category, with its whole history, to
    another budget account of the same period. A move to a budget account of the other
    period also needs `budget_amount`: the old budget versions are deleted and the new
    budget starts at the current month (monthly target) or at January of the current
    year (annual target).
    """

    # Optional but never null: `SkipJsonSchema` keeps null out of the OpenAPI/TS type,
    # and the validator below refuses an explicit null.
    name: Name | SkipJsonSchema[None] = None
    description: Description | None = None
    budget_account_id: int | SkipJsonSchema[None] = None
    # Absent and null differ: the service sees only the fields that were sent.
    budget_amount: Annotated[Money, Field(ge=0)] | None = Field(
        default=None,
        description="Only with a `budget_account_id` of the other period, and then required:"
        " the new budget; null means no budget",
    )
    rollover_from: Month | None = Field(
        default=None,
        description="Level 2 in a monthly budget account: carry what is left of the budget"
        " (or overspent) into the next month from this month on; null turns it off",
    )

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError(
                "at least one of name, description, budget_account_id, rollover_from is required"
            )
        for field in ("name", "budget_account_id"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class CategoryOrderIn(RequestSchema):
    """The complete new order of one sibling group: the level-1 categories when
    `parent_id` is null, otherwise the level-2 categories of that level-1 category."""

    parent_id: int | None = Field(description="Null reorders level 1")
    # Duplicates are refused by the service (`CATEGORY_ORDER_MISMATCH`), like any other
    # list that is not exactly the group.
    ordered_ids: list[int] = Field(
        min_length=1,
        description="Every category id of the group, each exactly once, in display order",
    )


class CategoryOut(Schema):
    id: int
    parent_id: int | None
    name: str
    description: str | None
    budget_account_id: int | None = Field(description="Set on level 2, null on level 1")
    rollover_from: Month | None = Field(
        description="Level 2: the month its rollover starts, or null (no rollover)"
    )

    @field_validator("rollover_from", mode="before")
    @classmethod
    def _month(cls, value: date | str | None) -> str | None:
        return format_month(value) if isinstance(value, date) else value


class CategoryLeaf(Schema):
    """A level-2 category. `description` is the user's note on what belongs here;
    `budget_account` is the budget pool it counts towards (for reference only)."""

    id: int
    name: str
    description: str | None
    budget_account: BudgetAccountOut
    rollover_from: Month | None = Field(
        description="The month from which what is left of its budget carries over, or null"
    )


class CategoryNode(Schema):
    """A level-1 category. Only its `children` (level 2) accept transactions and budgets."""

    id: int
    name: str
    children: list[CategoryLeaf]


class CategoryTree(Schema):
    budget_account_id: int | None = Field(
        description="The budget account the tree was filtered by; null for the whole tree"
    )
    categories: list[CategoryNode]
