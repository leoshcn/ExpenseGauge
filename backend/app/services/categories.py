"""Two-level categories. Level 1 groups; only level 2 takes transactions and budgets.

Only level 2 has a `description` (the user's note for the classifying agent); level-1
rows always keep it NULL.
"""

from typing import Any

from sqlalchemy import exists, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import get_by_id
from app.errors import conflict, invalid, not_found
from app.models import Category, Transaction
from app.schemas.category import CategoryLeaf, CategoryNode, CategoryTree
from app.services.accounts import get_account


def load_categories(db: Session, account_id: int) -> list[Category]:
    return list(
        db.scalars(select(Category).where(Category.account_id == account_id).order_by(Category.id))
    )


def build_nodes(categories: list[Category]) -> list[CategoryNode]:
    nodes = {
        c.id: CategoryNode(id=c.id, name=c.name, children=[])
        for c in categories
        if c.parent_id is None
    }
    for c in categories:
        if c.parent_id is not None:
            nodes[c.parent_id].children.append(
                CategoryLeaf(id=c.id, name=c.name, description=c.description)
            )
    return list(nodes.values())


def get_tree(db: Session, account_id: int) -> CategoryTree:
    get_account(db, account_id)
    return CategoryTree(
        account_id=account_id, categories=build_nodes(load_categories(db, account_id))
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


def create_category(
    db: Session,
    account_id: int,
    name: str,
    parent_id: int | None,
    description: str | None = None,
) -> Category:
    get_account(db, account_id)
    description = _normalize_description(description)
    if parent_id is not None:
        parent = get_by_id(db, Category, parent_id)
        if parent is None or parent.account_id != account_id:
            raise invalid(
                "INVALID_PARENT", "上级分类不存在或不属于该账户", {"parent_id": parent_id}
            )
        if parent.parent_id is not None:
            raise invalid(
                "INVALID_PARENT",
                "分类只支持两级，上级分类必须是一级分类",
                {"parent_id": parent_id},
            )
    _check_description(parent_id, description)
    category = Category(
        account_id=account_id, parent_id=parent_id, name=name, description=description
    )
    db.add(category)
    _commit_name(db)
    return category


def update_category(db: Session, category_id: int, fields: dict[str, Any]) -> Category:
    """Applies only the given fields (`name`, `description`); the others keep their value."""
    category = get_category(db, category_id)
    if "description" in fields:
        description = _normalize_description(fields["description"])
        _check_description(category.parent_id, description)
        category.description = description
    if "name" in fields:
        category.name = fields["name"]
    _commit_name(db)
    return category


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
