"""One global two-level category tree. Level 1 groups; only level 2 takes transactions
and budgets.

Each level-2 category belongs to exactly one budget account, which decides where its
transactions and budgets count; level 1 belongs to none (its figures are the sum of its
children). Only level 2 has a `description` (the user's note for the classifying agent);
level-1 rows always keep it NULL.
"""

from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import delete, exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import conflict, invalid, not_found
from app.models import Budget, BudgetAccount, Category, Transaction
from app.schemas.budget_account import BudgetAccountOut
from app.schemas.category import CategoryLeaf, CategoryNode, CategoryTree
from app.services.budget_accounts import budget_accounts_by_id, get_budget_account


def load_categories(db: Session, budget_account_id: int | None = None) -> list[Category]:
    """The whole tree, or only the level-2 categories of one budget account and their
    level-1 parents. Ordered by id."""
    categories = list(db.scalars(select(Category).order_by(Category.id)))
    if budget_account_id is None:
        return categories
    parent_ids = {c.parent_id for c in categories if c.budget_account_id == budget_account_id}
    return [c for c in categories if c.budget_account_id == budget_account_id or c.id in parent_ids]


def build_nodes(
    categories: list[Category], budget_accounts: dict[int, BudgetAccount]
) -> list[CategoryNode]:
    """Level-1 nodes with their level-2 children. `budget_accounts` is keyed by id."""
    nodes = {
        c.id: CategoryNode(id=c.id, name=c.name, children=[])
        for c in categories
        if c.parent_id is None
    }
    for c in categories:
        if c.parent_id is not None:
            nodes[c.parent_id].children.append(to_leaf(c, budget_accounts))
    return list(nodes.values())


def to_leaf(category: Category, budget_accounts: dict[int, BudgetAccount]) -> CategoryLeaf:
    return CategoryLeaf(
        id=category.id,
        name=category.name,
        description=category.description,
        budget_account=BudgetAccountOut.model_validate(budget_accounts[category.budget_account_id]),
    )


def get_tree(db: Session, budget_account_id: int | None = None) -> CategoryTree:
    if budget_account_id is not None:
        get_budget_account(db, budget_account_id, status_code=422)
    return CategoryTree(
        budget_account_id=budget_account_id,
        categories=build_nodes(load_categories(db, budget_account_id), budget_accounts_by_id(db)),
    )


def get_category(db: Session, category_id: int) -> Category:
    category = get_by_id(db, Category, category_id)
    if category is None:
        raise not_found("CATEGORY_NOT_FOUND", "分类不存在")
    return category


def _commit_name(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise conflict("CATEGORY_NAME_TAKEN", "同一层级下已存在同名分类") from exc


def _normalize_description(description: str | None) -> str | None:
    """Blank (already stripped by the schema) means no description."""
    return description or None


def _check_description(parent_id: int | None, description: str | None) -> None:
    if parent_id is None and description is not None:
        raise invalid("DESCRIPTION_NOT_ALLOWED", "一级分类不支持填写说明")


def _check_budget_account(db: Session, parent_id: int | None, budget_account_id: int | None):
    """Level 2 needs an existing budget account; level 1 must not have one."""
    if parent_id is None:
        if budget_account_id is not None:
            raise invalid(
                "BUDGET_ACCOUNT_NOT_ALLOWED",
                "一级分类不归属预算账户，只有二级分类需要选择预算账户",
                {"budget_account_id": budget_account_id},
            )
        return
    if budget_account_id is None:
        raise invalid(
            "VALIDATION_ERROR",
            "二级分类必须选择所属预算账户",
            {"errors": [{"field": "body.budget_account_id", "reason": "required for level 2"}]},
        )
    get_budget_account(db, budget_account_id, status_code=422)


def create_category(
    db: Session,
    name: str,
    parent_id: int | None,
    description: str | None = None,
    budget_account_id: int | None = None,
) -> Category:
    description = _normalize_description(description)
    if parent_id is not None:
        parent = get_by_id(db, Category, parent_id)
        if parent is None:
            raise invalid("INVALID_PARENT", "上级分类不存在", {"parent_id": parent_id})
        if parent.parent_id is not None:
            raise invalid(
                "INVALID_PARENT",
                "分类只支持两级，上级分类必须是一级分类",
                {"parent_id": parent_id},
            )
    _check_description(parent_id, description)
    _check_budget_account(db, parent_id, budget_account_id)
    category = Category(
        parent_id=parent_id,
        name=name,
        description=description,
        budget_account_id=budget_account_id,
    )
    db.add(category)
    _commit_name(db)
    return category


def update_category(db: Session, category_id: int, fields: dict[str, Any]) -> Category:
    """Applies only the given fields (`name`, `description`, `budget_account_id`,
    `budget_amount`); the others keep their value.

    A new budget account of the same period moves the category's whole history. One of
    the other period (monthly <-> annual) needs `budget_amount` (None = no budget): the
    old budget versions would mean the wrong thing, so they are all deleted and the new
    budget starts at the current month (monthly target) or at January of the current
    year (annual target). All in the same transaction as the move.
    """
    category = get_category(db, category_id)
    cross_period = False
    if "budget_account_id" in fields:
        _check_budget_account(db, category.parent_id, fields["budget_account_id"])
        target = get_budget_account(db, fields["budget_account_id"], status_code=422)
        current = get_budget_account(db, category.budget_account_id)
        cross_period = target.period != current.period
        if cross_period and "budget_amount" not in fields:
            raise invalid(
                "BUDGET_RESET_REQUIRED",
                "跨周期移动需要重新设置预算：请填写新预算金额，或明确设为无预算",
                {"from_period": current.period, "to_period": target.period},
            )
    if "budget_amount" in fields and not cross_period:
        raise invalid(
            "BUDGET_RESET_NOT_ALLOWED",
            "只有把分类移动到不同周期的预算账户时才能同时设置预算，请在预算页修改预算",
        )
    if "description" in fields:
        description = _normalize_description(fields["description"])
        _check_description(category.parent_id, description)
        category.description = description
    if "budget_account_id" in fields:
        category.budget_account_id = fields["budget_account_id"]
        if cross_period:
            _reset_budget(db, category.id, target.period, fields["budget_amount"])
    if "name" in fields:
        category.name = fields["name"]
    _commit_name(db)
    return category


def _reset_budget(db: Session, category_id: int, period: str, amount: Decimal | None) -> None:
    """Replaces every budget version of the category with one starting now (this month,
    or January of this year for an annual budget account); no version when `amount` is
    None. Not committed here."""
    db.execute(delete(Budget).where(Budget.category_id == category_id))
    if amount is None:
        return
    today = date.today()
    start = date(today.year, 1, 1) if period == "year" else today.replace(day=1)
    db.add(Budget(category_id=category_id, effective_from=start, amount=amount))


def delete_category(db: Session, category_id: int) -> None:
    """Deletes an unused category. Budgets of a deleted level-2 category go with it."""
    category = get_category(db, category_id)
    if category.parent_id is None:
        if db.scalar(select(exists().where(Category.parent_id == category.id))):
            raise conflict("CATEGORY_HAS_CHILDREN", "该一级分类下还有二级分类，无法删除")
    elif db.scalar(select(exists().where(Transaction.category_id == category.id))):
        raise conflict("CATEGORY_IN_USE", "该分类下已有流水，无法删除")
    db.delete(category)
    try:
        db.commit()
    except IntegrityError as exc:  # a transaction or child arrived concurrently
        db.rollback()
        raise conflict("CATEGORY_IN_USE", "该分类下已有流水，无法删除") from exc
