"""AI insights: the service settings (the API key is write-only) and the cached insight."""

from datetime import datetime
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import AfterValidator, Field, StringConstraints, field_validator

from app.schemas.common import Month, NoNul, RequestSchema, Schema

MAX_POINTS = 5


def _http_url(value: str) -> str:
    """Trimmed, without trailing slashes, and http(s) with a host."""
    value = value.rstrip("/")
    parts = urlsplit(value)
    if parts.scheme not in {"http", "https"} or not parts.netloc:
        raise ValueError("must be an http:// or https:// URL")
    return value


BaseUrl = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
    NoNul,
    AfterValidator(_http_url),
]
ModelName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200), NoNul
]


def _header_safe(value: str) -> str:
    """The key goes into an HTTP header, which only carries printable ASCII. (The message
    never repeats the key.)"""
    if not all("!" <= char <= "~" for char in value):
        raise ValueError("must contain only printable ASCII characters without spaces")
    return value


ApiKey = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=2000),
    NoNul,
    AfterValidator(_header_safe),
]


class AiSettingsOut(Schema):
    base_url: str | None = Field(description="Base URL of the OpenAI-compatible API")
    model: str | None
    api_key_set: bool = Field(description="Whether an API key is stored; the key is never returned")
    api_key_hint: str | None = Field(description="Last 4 characters of the stored key, if any")
    configured: bool = Field(description="Base URL and model are both set (the key is optional)")


class AiSettingsUpdateIn(RequestSchema):
    """`api_key` omitted keeps the stored key, a string replaces it, `null` clears it."""

    base_url: BaseUrl = Field(description="For example https://api.openai.com/v1")
    model: ModelName
    api_key: ApiKey | None = None


class AiTestOut(Schema):
    model: str
    latency_ms: int


Tone = Literal["warning", "positive", "neutral"]


class InsightPoint(Schema):
    tone: Tone = Field(
        description="warning: overspend or anomaly; positive: under budget or improvement"
    )
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]


class InsightContent(Schema):
    """What the model must return, and what is stored. Longer point lists are cut to 5."""

    summary: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
    month_points: list[InsightPoint]
    year_points: list[InsightPoint]

    @field_validator("month_points", "year_points")
    @classmethod
    def _at_most_five(cls, points: list[InsightPoint]) -> list[InsightPoint]:
        return points[:MAX_POINTS]


class InsightOut(InsightContent):
    model: str = Field(description="Model that produced the insight")
    generated_at: datetime


class InsightStateOut(Schema):
    month: Month
    configured: bool = Field(description="Whether an AI service is configured")
    insight: InsightOut | None = Field(description="The cached insight of the month, if any")
    stale: bool = Field(
        description="The month's data changed since the insight was generated; false without one"
    )
