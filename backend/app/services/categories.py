"""Two-level categories. Level 1 groups; only level 2 takes transactions and budgets."""

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
            nodes[c.parent_id].children.append(CategoryLeaf(id=c.id, name=c.name))
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


def create_category(db: Session, account_id: int, name: str, parent_id: int | None) -> Category:
    get_account(db, account_id)
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
    category = Category(account_id=account_id, parent_id=parent_id, name=name)
    db.add(category)
    _commit_name(db)
    return category


def rename_category(db: Session, category_id: int, name: str) -> Category:
    category = get_category(db, category_id)
    category.name = name
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
