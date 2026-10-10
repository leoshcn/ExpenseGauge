"""MCP server: three tools over the same service functions the REST routers call.

No rule lives here. A tool opens a database session, calls one service function and
returns the REST payload. Authentication is the ASGI middleware below, which uses the
same token check as REST.
"""

import json
from collections.abc import Callable
from typing import Any

import anyio.to_thread
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, TextContent
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

from app.db import get_sessionmaker
from app.deps import bearer_value
from app.errors import AppError
from app.schemas.transaction import RawTransactionItem
from app.services import auth as auth_service
from app.services import budgets as budget_service
from app.services import categories as category_service
from app.services import transactions as transaction_service

INSTRUCTIONS = (
    "ExpenseGauge: read an account's categories and budgets, then submit confirmed "
    "expense/refund transactions. Batches are all-or-nothing; read the per-item feedback "
    "in a rejected result. confirm_duplicate is single-use."
)


async def _run[T](fn: Callable[[Session], T]) -> T:
    """Runs a (blocking) service call in a worker thread with its own session."""

    def call() -> T:
        with get_sessionmaker()() as db:
            return fn(db)

    return await anyio.to_thread.run_sync(call)


def _error_result(error: AppError) -> CallToolResult:
    """An anticipated failure, as the same envelope REST returns."""
    envelope = error.envelope()
    return CallToolResult(
        content=[TextContent(type="text", text=json.dumps(envelope, ensure_ascii=False))],
        structured_content=envelope,
        is_error=True,
    )


def _api_token_id(ctx: Context) -> int | None:
    request = ctx.request_context.request
    return getattr(getattr(request, "state", None), "api_token_id", None)


def create_mcp_server() -> MCPServer:
    server = MCPServer("expensegauge", instructions=INSTRUCTIONS)

    @server.tool()
    async def list_categories(account_id: int) -> dict[str, Any]:
        """Return the account's full two-level category tree.

        Transactions may only use level-2 categories (the `children`).
        """
        try:
            tree = await _run(lambda db: category_service.get_tree(db, account_id))
        except AppError as error:
            return _error_result(error)
        return tree.model_dump(mode="json")

    @server.tool()
    async def get_budgets(account_id: int, month: str | None = None) -> dict[str, Any]:
        """Return the budget in force per level-2 category for a month.

        `month` is `YYYY-MM` and defaults to the current month. `amount: null` means the
        category has no budget.
        """
        try:
            budgets = await _run(lambda db: budget_service.get_budgets(db, account_id, month))
        except AppError as error:
            return _error_result(error)
        return budgets.model_dump(mode="json")

    @server.tool()
    async def submit_transactions(
        account_id: int, items: list[RawTransactionItem], ctx: Context
    ) -> dict[str, Any]:
        """Submit a batch of expenses (amount > 0) and refunds (amount < 0). All or nothing.

        Each item: date (YYYY-MM-DD), amount, counterparty, description, category_id
        (level 2), optional note, optional confirm_duplicate.

        On success: `{"accepted": true, "transactions": [...]}`. If any item is rejected
        nothing is stored and the result is `{"accepted": false, "code": "BATCH_REJECTED",
        "message", "details": {"items": [...]}}` with a reason code and a Chinese message
        per item. Set confirm_duplicate=true on an item only after the user confirmed a
        reported duplicate is a real second transaction, and only for that one resubmission.
        """
        token_id = _api_token_id(ctx)
        try:
            accepted = await _run(
                lambda db: transaction_service.submit_batch(
                    db, account_id, items, api_token_id=token_id
                )
            )
        except AppError as error:
            if error.code == "BATCH_REJECTED":
                # A normal result, so the agent reads the per-item feedback.
                return {"accepted": False, **error.envelope()}
            return _error_result(error)
        return accepted.model_dump(mode="json")

    return server


class BearerTokenMiddleware:
    """Lets a request through to the MCP app only with a live agent token."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = dict(scope["headers"])
        raw = bearer_value(headers.get(b"authorization", b"").decode("latin-1"))
        token = await _run(lambda db: auth_service.resolve_token(db, raw))
        if token is None:
            error = AppError(401, "INVALID_TOKEN", "令牌无效或已被吊销")
            response = JSONResponse(
                error.envelope(), status_code=401, headers={"WWW-Authenticate": "Bearer"}
            )
            await response(scope, receive, send)
            return
        scope.setdefault("state", {})["api_token_id"] = token.id
        await self.app(scope, receive, send)


def create_mcp_app() -> tuple[ASGIApp, MCPServer]:
    """The ASGI app to mount at `/mcp`, and its server (whose session manager the host
    application must run in its lifespan)."""
    server = create_mcp_server()
    app = server.streamable_http_app(
        streamable_http_path="/",
        stateless_http=True,
        json_response=True,
        # Reached through nginx on a LAN host name, so Host cannot be pinned to localhost.
        # Every request needs a Bearer token, which a rebinding page does not have.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    return BearerTokenMiddleware(app), server
