from fastapi import APIRouter

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.schemas.category import (
    CategoryCreateIn,
    CategoryOrderIn,
    CategoryOut,
    CategoryTree,
    CategoryUpdateIn,
)
from app.services import categories as category_service

router = APIRouter(tags=["categories"])


@router.get("/categories", response_model=CategoryTree)
def get_category_tree(principal: AnyPrincipal, db: DbSession, budget_account_id: int | None = None):
    """The global two-level tree, or only one budget account's level-2 categories and
    their level-1 parents. Open to agent tokens."""
    return category_service.get_tree(db, budget_account_id)


@router.post("/categories", response_model=CategoryOut, status_code=201)
def create_category(payload: CategoryCreateIn, principal: SessionPrincipal, db: DbSession):
    """A level-2 category (with `parent_id`) needs `budget_account_id`; level 1 refuses it."""
    return category_service.create_category(
        db, payload.name, payload.parent_id, payload.description, payload.budget_account_id
    )


@router.put("/categories/order", response_model=CategoryTree)
def reorder_categories(payload: CategoryOrderIn, principal: SessionPrincipal, db: DbSession):
    """Sets the display order of one sibling group (level 1, or one level-1 category's
    children) and returns the whole tree. The ids must be exactly those of the group
    (422 `CATEGORY_ORDER_MISMATCH`), so a level-2 category cannot change its parent here."""
    return category_service.reorder_categories(db, payload.parent_id, payload.ordered_ids)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def update_category(
    category_id: int, payload: CategoryUpdateIn, principal: SessionPrincipal, db: DbSession
):
    """Partial update: name, and for level 2 description and budget account. Omitted
    fields are kept. A new budget account of the same period takes the category's history
    with it; one of the other period needs `budget_amount` (422 `BUDGET_RESET_REQUIRED`)
    and replaces the history with that budget."""
    return category_service.update_category(db, category_id, payload.model_dump(exclude_unset=True))


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, principal: SessionPrincipal, db: DbSession):
    category_service.delete_category(db, category_id)
