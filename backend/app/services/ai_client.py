"""Calls an OpenAI-compatible chat completions API with httpx: the only outbound HTTP
request the backend makes.

`POST {base_url}/chat/completions` with `{model, messages}` and nothing else, because
compatible servers differ on what else they accept. The key goes only into the
`Authorization` header; it is never part of an error, a log line or a repr.

Failures become `AppError`s: `AI_PROVIDER_TIMEOUT` (504) for a timeout,
`AI_PROVIDER_ERROR` (502) for a connection failure or a non-2xx answer,
`AI_INVALID_RESPONSE` (502) for a body without `choices[0].message.content`.

Tests replace `_transport` with an `httpx.MockTransport`.
"""

import json
import re
import time
from typing import Any

import httpx
from sqlalchemy.orm import Session

from app.errors import AppError
from app.schemas.ai import AiTestOut
from app.services.ai_settings import AiConfig, require_config

# Reasoning models can take minutes. nginx waits 300 s for /api/v1/insights/, above this.
TIMEOUT = httpx.Timeout(240, connect=10)
PROVIDER_MESSAGE_LIMIT = 300

# Test seam: an `httpx.MockTransport` in tests, None (the network) otherwise.
_transport: httpx.BaseTransport | None = None

_THINK = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)
_FENCE_START = re.compile(r"^```[A-Za-z]*\s*")
_FENCE_END = re.compile(r"\s*```$")


def _scrub(text: str, config: AiConfig) -> str:
    """The provider's own error text, shortened, with the key masked should it echo it."""
    if config.api_key:
        text = text.replace(config.api_key, "***")
    return text[:PROVIDER_MESSAGE_LIMIT]


def _provider_message(response: httpx.Response, config: AiConfig) -> str | None:
    try:
        body = response.json()
    except ValueError:
        body = None
    message: Any = None
    if isinstance(body, dict):
        error = body.get("error")
        message = error.get("message") if isinstance(error, dict) else error
        message = message or body.get("message") or body.get("detail")
    if not isinstance(message, str):
        message = response.text
    message = message.strip()
    return _scrub(message, config) if message else None


def _status_error(response: httpx.Response, config: AiConfig) -> AppError:
    status = response.status_code
    if status in {401, 403}:
        message = "API Key 无效或无权限"
    elif status == 404:
        message = "AI 服务地址或模型不存在，请检查 Base URL 和模型名"
    elif status == 429:
        message = "AI 服务请求过于频繁或额度不足，请稍后重试"
    else:
        message = f"AI 服务返回错误（HTTP {status}）"
    details: dict[str, Any] = {"status": status}
    provider_message = _provider_message(response, config)
    if provider_message:
        details["provider_message"] = provider_message
    return AppError(502, "AI_PROVIDER_ERROR", message, details)


def invalid_response(reason: str) -> AppError:
    return AppError(
        502,
        "AI_INVALID_RESPONSE",
        "AI 服务返回的内容无法识别，请重试或换用其他模型",
        {"reason": reason},
    )


def chat(config: AiConfig, messages: list[dict[str, str]]) -> str:
    """The text of `choices[0].message.content` of one chat completion."""
    headers = {"Content-Type": "application/json"}
    if config.api_key:
        headers["Authorization"] = f"Bearer {config.api_key}"
    try:
        with httpx.Client(timeout=TIMEOUT, transport=_transport) as client:
            response = client.post(
                f"{config.base_url}/chat/completions",
                json={"model": config.model, "messages": messages},
                headers=headers,
            )
    except httpx.TimeoutException:
        raise AppError(
            504, "AI_PROVIDER_TIMEOUT", "AI 服务响应超时，请稍后重试或换用更快的模型"
        ) from None
    except (httpx.HTTPError, httpx.InvalidURL) as exc:
        raise AppError(
            502,
            "AI_PROVIDER_ERROR",
            "无法连接 AI 服务，请检查 Base URL 和网络",
            {"provider_message": _scrub(type(exc).__name__, config)},
        ) from None
    if not response.is_success:
        raise _status_error(response, config)
    try:
        content = response.json()["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise invalid_response("no_content") from None
    if not isinstance(content, str):
        raise invalid_response("no_content")
    return content


def check_connection(db: Session) -> AiTestOut:
    """One minimal request with the saved configuration, timed. No `max_tokens`: some
    providers reject it."""
    config = require_config(db)
    db.rollback()  # no transaction stays open while the provider answers
    started = time.perf_counter()
    chat(config, [{"role": "user", "content": "ping"}])
    return AiTestOut(model=config.model, latency_ms=round((time.perf_counter() - started) * 1000))


def parse_json_content(content: str) -> Any:
    """The JSON a model answered with, tolerating `<think>` blocks and a ``` fence around
    it; `AI_INVALID_RESPONSE` when there is none."""
    text = _THINK.sub("", content).strip()
    text = _FENCE_END.sub("", _FENCE_START.sub("", text)).strip()
    try:
        return json.loads(text)
    except ValueError:
        pass
    # Some models add a sentence around the object; try the outermost braces.
    start, end = text.find("{"), text.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(text[start : end + 1])
        except ValueError:
            pass
    raise invalid_response("not_json")
