from typing import Self

from pydantic import model_validator
from pydantic.json_schema import SkipJsonSchema

from app.schemas.common import Description, Name, RequestSchema, Schema


class CategoryCreateIn(RequestSchema):
    name: Name
    parent_id: int | None = None
    # Level 2 only; a non-blank description on a level-1 category is refused.
    description: Description | None = None


class CategoryUpdateIn(RequestSchema):
    """Partial update: fields left out keep their value. `description` null or blank clears it."""

    # Optional but never null: `SkipJsonSchema` keeps null out of the OpenAPI/TS type,
    # and the validator below refuses an explicit null.
    name: Name | SkipJsonSchema[None] = None
    description: Description | None = None

    @model_validator(mode="after")
    def _check_fields(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("at least one of name, description is required")
        if "name" in self.model_fields_set and self.name is None:
            raise ValueError("name cannot be null")
        return self


class CategoryOut(Schema):
    id: int
    account_id: int
    parent_id: int | None
    name: str
    description: str | None


class CategoryLeaf(Schema):
    """A level-2 category. `description` is the user's note on what belongs here."""

    id: int
    name: str
    description: str | None


class CategoryNode(Schema):
    """A level-1 category. Only its `children` (level 2) accept transactions and budgets."""

    id: int
    name: str
    children: list[CategoryLeaf]


class CategoryTree(Schema):
    account_id: int
    categories: list[CategoryNode]
