"""MCP server: five tools over the same service functions the REST routers call.

No rule lives here. A tool opens a database session, calls one service function and
returns the REST payload. Authentication is the ASGI middleware below, which uses the
same token check as REST.
"""

import json
from collections.abc import Callable
from datetime import date
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
from app.schemas.channel import ChannelOut
from app.schemas.transaction import RawTransactionItem
from app.services import auth as auth_service
from app.services import budgets as budget_service
from app.services import categories as category_service
from app.services import channels as channel_service
from app.services import transactions as transaction_service

INSTRUCTIONS = (
    "ExpenseGauge: list the payment channels and the global category tree, then submit "
    "confirmed expense/refund transactions of one channel per batch. Any level-2 category "
    "can be used; its budget account is shown for reference only. Amounts are in the base "
    "currency (convert foreign-currency spending at that day's rate before submitting). "
    "Batches are all-or-nothing; read the per-item feedback in a rejected result. "
    "confirm_duplicate is single-use. A level-2 category may carry a `description` written "
    "by the user (what belongs / does not belong there); follow it when classifying. "
    "Before submitting a refund (negative amount), call find_payments to find the payment it "
    "reverses and set the refund's refund_of_id (or refund_of_index when that payment is an "
    "item of the same batch); if you cannot find it or are unsure, ask the user, and leave "
    "both out if it still cannot be determined (the refund is then stored unmatched)."
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
    async def list_channels() -> dict[str, Any]:
        """Return the payment channels: `{"channels": [{"id", "name"}, ...]}`.

        A channel is where transactions come from (a card, a statement). Submit each
        channel's transactions with its `id`; duplicates are checked within one channel.
        """
        try:
            channels = await _run(channel_service.list_channels)
        except AppError as error:
            return _error_result(error)
        return {
            "channels": [ChannelOut.model_validate(c).model_dump(mode="json") for c in channels]
        }

    @server.tool()
    async def list_categories() -> dict[str, Any]:
        """Return the global two-level category tree.

        Transactions may only use level-2 categories (the `children`), any of them. Each
        level-2 category shows its `budget_account` `{id, name}` for reference only; it
        does not restrict which channel may use it. A level-2 category may carry a
        `description` written by the user (what belongs / does not belong there); follow
        it when classifying. `description` is null when none was written. The array order
        is the display order the user chose; it does not express priority.
        """
        try:
            tree = await _run(category_service.get_tree)
        except AppError as error:
            return _error_result(error)
        return tree.model_dump(mode="json")

    @server.tool()
    async def get_budgets(
        month: str | None = None, budget_account_id: int | None = None
    ) -> dict[str, Any]:
        """Return the budget in force per level-2 category for a month.

        `month` is `YYYY-MM` and defaults to the current month. `budget_account_id`
        narrows the list to one budget account; omitted, every level-2 category is listed.
        `amount: null` means the category has no budget that month (never set, or
        cleared); `"0.00"` is a real budget. `period` is the budget account's period:
        `"month"` means `amount` is per month; `"year"` means `amount` is for the whole
        calendar year (compare it with the year-to-date spending, not one month's).
        """
        try:
            budgets = await _run(
                lambda db: budget_service.get_budgets(db, month, budget_account_id)
            )
        except AppError as error:
            return _error_result(error)
        return budgets.model_dump(mode="json")

    @server.tool()
    async def find_payments(
        date_from: date,
        date_to: date,
        channel_id: int | None = None,
        counterparty: str | None = None,
        limit: int = 20,
    ) -> dict[str, Any]:
        """Find stored payments (expenses, never refunds), to match a refund to the payment
        it reverses: `{"payments": [{id, channel_id, channel_name, date, amount,
        counterparty, description, category_id, category_name, refunded, refundable}]}`,
        newest first.

        `date_from` / `date_to` (YYYY-MM-DD, inclusive) may span at most 366 days; a
        payment is never dated after its refund. Optional `channel_id` (a refund often,
        not always, comes back on the paying channel) and `counterparty` (matched
        anywhere, ignoring case). `limit` is 1 to 50. `refundable` is what a new refund
        of that payment may not exceed. Use the chosen payment's `id` as the refund's
        `refund_of_id` in submit_transactions.
        """
        try:
            found = await _run(
                lambda db: transaction_service.search_payments(
                    db, date_from, date_to, channel_id, counterparty, limit
                )
            )
        except AppError as error:
            return _error_result(error)
        return found.model_dump(mode="json")

    @server.tool()
    async def submit_transactions(
        channel_id: int, items: list[RawTransactionItem], ctx: Context
    ) -> dict[str, Any]:
        """Submit one payment channel's expenses (amount > 0) and refunds (amount < 0).
        All or nothing.

        `channel_id` comes from list_channels. Each item: date (YYYY-MM-DD), amount (in
        the base currency), counterparty, description, category_id (any level-2
        category), optional note, optional confirm_duplicate.

        A refund may name the payment it reverses, with at most one of: `refund_of_id`
        (a stored payment's `id` from find_payments) or `refund_of_index` (the index of a
        payment item in this same batch). The refund then counts against that payment's
        month and category; still give it a level-2 `category_id` (used if the user later
        removes the match). Rejected as `INVALID_REFUND_TARGET` when the target is not a
        payment, is dated after the refund or the item is not a refund, and as
        `REFUND_EXCEEDS_PAYMENT` when the payment's matched refunds would exceed it.
        Without either field the refund is stored unmatched, as before.

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
                    db, channel_id, items, api_token_id=token_id
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
