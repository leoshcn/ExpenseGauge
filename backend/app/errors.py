"""The single error type services raise, and the envelope every non-2xx response uses."""

from typing import Any

from pydantic import BaseModel, Field


class ErrorEnvelope(BaseModel):
    """Body of every non-2xx response."""

    code: str = Field(description="Stable English reason code")
    message: str = Field(description="Chinese message that can be shown to the user")
    details: dict[str, Any] = Field(default_factory=dict)


class AppError(Exception):
    """An anticipated failure. `code` is English and stable; `message` is Chinese."""

    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        details: dict[str, Any] | None = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.status_code = status_code
        self.code = code
        self.message = message
        self.details = details or {}

    def envelope(self) -> dict[str, Any]:
        return {"code": self.code, "message": self.message, "details": self.details}


def not_found(code: str, message: str) -> AppError:
    return AppError(404, code, message)


def conflict(code: str, message: str, details: dict[str, Any] | None = None) -> AppError:
    return AppError(409, code, message, details)


def invalid(code: str, message: str, details: dict[str, Any] | None = None) -> AppError:
    return AppError(422, code, message, details)
