"""REST routers. `api_router` is everything under `/api/v1`."""

from fastapi import APIRouter, Depends

from app.deps import require_json_body
from app.errors import ErrorEnvelope
from app.routers import accounts, auth, budgets, categories, summaries, transactions

api_router = APIRouter(
    prefix="/api/v1",
    dependencies=[Depends(require_json_body)],
    responses={
        "default": {"model": ErrorEnvelope, "description": "Any non-2xx response"},
        422: {"model": ErrorEnvelope, "description": "Validation error"},
    },
)


@api_router.get("/health", tags=["health"])
def health() -> dict[str, str]:
    return {"status": "ok"}


for module in (auth, accounts, categories, budgets, transactions, summaries):
    api_router.include_router(module.router)
