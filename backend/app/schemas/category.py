from app.schemas.common import Name, RequestSchema, Schema


class CategoryCreateIn(RequestSchema):
    name: Name
    parent_id: int | None = None


class CategoryUpdateIn(RequestSchema):
    name: Name


class CategoryOut(Schema):
    id: int
    account_id: int
    parent_id: int | None
    name: str


class CategoryLeaf(Schema):
    id: int
    name: str


class CategoryNode(Schema):
    """A level-1 category. Only its `children` (level 2) accept transactions and budgets."""

    id: int
    name: str
    children: list[CategoryLeaf]


class CategoryTree(Schema):
    account_id: int
    categories: list[CategoryNode]
