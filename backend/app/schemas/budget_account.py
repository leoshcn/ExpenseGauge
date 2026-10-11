from app.schemas.common import Name, RequestSchema, Schema


class BudgetAccountCreateIn(RequestSchema):
    name: Name


class BudgetAccountUpdateIn(RequestSchema):
    name: Name


class BudgetAccountOut(Schema):
    id: int
    name: str
