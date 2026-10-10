"""Application factory: REST under `/api/v1`, MCP Streamable HTTP under `/mcp`."""

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Receive, Scope, Send

from app.errors import AppError
from app.mcp import create_mcp_app
from app.routers import api_router

logger = logging.getLogger("expense_gauge")

MCP_PATH = "/mcp"

_HTTP_ERRORS = {
    404: ("NOT_FOUND", "请求的资源不存在"),
    405: ("METHOD_NOT_ALLOWED", "不支持的请求方法"),
}


def _envelope(status_code: int, code: str, message: str, details: dict | None = None):
    return JSONResponse(
        {"code": code, "message": message, "details": details or {}}, status_code=status_code
    )


def _register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        return JSONResponse(exc.envelope(), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError):
        errors = [
            {"field": ".".join(str(part) for part in error["loc"]), "reason": error["msg"]}
            for error in exc.errors()
        ]
        return _envelope(422, "VALIDATION_ERROR", "请求参数无效", {"errors": errors})

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException):
        code, message = _HTTP_ERRORS.get(exc.status_code, ("HTTP_ERROR", "请求无法处理"))
        return _envelope(exc.status_code, code, message)

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return _envelope(500, "INTERNAL_ERROR", "服务器内部错误")


class McpPathMiddleware:
    """Serves `/mcp` and `/mcp/` alike: without this the mount answers `/mcp` with a
    redirect, which breaks clients behind a reverse proxy."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and scope["path"] == MCP_PATH:
            scope = {**scope, "path": MCP_PATH + "/", "raw_path": (MCP_PATH + "/").encode()}
        await self.app(scope, receive, send)


def create_app() -> FastAPI:
    mcp_app, mcp_server = create_mcp_app()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # A mounted app's own lifespan never runs, so the MCP session manager starts here.
        async with mcp_server.session_manager.run():
            yield

    app = FastAPI(
        title="ExpenseGauge API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )
    _register_error_handlers(app)
    app.include_router(api_router)
    app.mount(MCP_PATH, mcp_app)
    app.add_middleware(McpPathMiddleware)
    return app


app = create_app()
