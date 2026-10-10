from fastapi import APIRouter

from app.deps import AnyPrincipal, DbSession, SessionPrincipal
from app.schemas.category import CategoryCreateIn, CategoryOut, CategoryTree, CategoryUpdateIn
from app.services import categories as category_service

router = APIRouter(tags=["categories"])


@router.get("/accounts/{account_id}/categories", response_model=CategoryTree)
def get_category_tree(account_id: int, principal: AnyPrincipal, db: DbSession):
    """The account's full two-level tree. Open to agent tokens."""
    return category_service.get_tree(db, account_id)


@router.post("/accounts/{account_id}/categories", response_model=CategoryOut, status_code=201)
def create_category(
    account_id: int, payload: CategoryCreateIn, principal: SessionPrincipal, db: DbSession
):
    return category_service.create_category(db, account_id, payload.name, payload.parent_id)


@router.patch("/categories/{category_id}", response_model=CategoryOut)
def rename_category(
    category_id: int, payload: CategoryUpdateIn, principal: SessionPrincipal, db: DbSession
):
    return category_service.rename_category(db, category_id, payload.name)


@router.delete("/categories/{category_id}", status_code=204)
def delete_category(category_id: int, principal: SessionPrincipal, db: DbSession):
    category_service.delete_category(db, category_id)
