from typing import Annotated, Self

from pydantic import Field, model_validator
from pydantic.json_schema import SkipJsonSchema

from app.schemas.budget_account import BudgetAccountOut
from app.schemas.common import Description, Money, Name, RequestSchema, Schema


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

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one of name, description, budget_account_id is required")
        for field in ("name", "budget_account_id"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class CategoryOut(Schema):
    id: int
    parent_id: int | None
    name: str
    description: str | None
    budget_account_id: int | None = Field(description="Set on level 2, null on level 1")


class CategoryLeaf(Schema):
    """A level-2 category. `description` is the user's note on what belongs here;
    `budget_account` is the budget pool it counts towards (for reference only)."""

    id: int
    name: str
    description: str | None
    budget_account: BudgetAccountOut


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
