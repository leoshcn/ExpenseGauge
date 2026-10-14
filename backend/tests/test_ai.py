"""AI insights (task 10-13-ai-insights): the write-only AI settings, the connection test,
and generating, caching and invalidating a month's insight. The provider is an
`httpx.MockTransport`; nothing leaves the machine."""

import json
from collections.abc import Callable
from datetime import date

import httpx
import pytest

from app.months import add_months, format_month
from app.services import ai_client, insights
from tests.conftest import Ledger
from tests.test_auth import API, assert_envelope

SETTINGS = f"{API}/ai/settings"
KEY = "sk-test-secret-key-wxyz"
MONTH = "2026-09"
INSIGHT = f"{API}/insights/{MONTH}"

CONTENT = {
    "summary": "九月买菜超支，其余分类正常。",
    "month_points": [
        {"tone": "warning", "text": "买菜支出 ¥1,200.00，超出预算 20%。"},
        {"tone": "positive", "text": "外食低于预算。"},
    ],
    "year_points": [{"tone": "neutral", "text": "保险年初至今支出 ¥3,000.00。"}],
}


class Provider:
    """A fake OpenAI-compatible server: records requests, answers with `reply`."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.reply: Callable[[httpx.Request], httpx.Response] = lambda request: self.content(
            json.dumps(CONTENT, ensure_ascii=False)
        )

    @staticmethod
    def content(text: str) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": text}}]})

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        return self.reply(request)

    def body(self, index: int = -1) -> dict:
        return json.loads(self.requests[index].content)

    def data(self, index: int = -1) -> dict:
        """The input JSON sent in the user message."""
        user = self.body(index)["messages"][-1]["content"]
        return json.loads(user.split("数据：\n", 1)[1])


@pytest.fixture
def provider(monkeypatch) -> Provider:
    fake = Provider()
    monkeypatch.setattr(ai_client, "_transport", httpx.MockTransport(fake.handle))
    return fake


def configure(client, **overrides):
    body = {"base_url": "https://llm.example.com/v1/", "model": "gpt-test", "api_key": KEY}
    body.update(overrides)
    response = client.put(SETTINGS, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_api_key_is_write_only(client):
    """AC1: GET shows only whether a key is set and its last 4 characters; an omitted key
    is kept, `null` clears it; no response carries the key."""
    assert client.get(SETTINGS).json() == {
        "base_url": None,
        "model": None,
        "api_key_set": False,
        "api_key_hint": None,
        "configured": False,
    }

    saved = client.put(
        SETTINGS,
        json={"base_url": " https://llm.example.com/v1/ ", "model": "gpt-test", "api_key": KEY},
    )
    assert saved.status_code == 200, saved.text
    expected = {
        "base_url": "https://llm.example.com/v1",
        "model": "gpt-test",
        "api_key_set": True,
        "api_key_hint": "wxyz",
        "configured": True,
    }
    assert saved.json() == expected
    got = client.get(SETTINGS)
    assert got.json() == expected
    assert KEY not in saved.text and KEY not in got.text

    kept = client.put(SETTINGS, json={"base_url": "http://ollama:11434/v1", "model": "qwen3"})
    assert kept.json() == {
        **expected,
        "base_url": "http://ollama:11434/v1",
        "model": "qwen3",
    }

    replaced = configure(client, api_key="sk-another-key-1234")
    assert replaced["api_key_hint"] == "1234"

    cleared = client.put(
        SETTINGS, json={"base_url": "http://ollama:11434/v1", "model": "qwen3", "api_key": None}
    )
    assert cleared.json()["api_key_set"] is False and cleared.json()["api_key_hint"] is None
    assert cleared.json()["configured"] is True

    # A short key gets no hint: its last 4 characters would give most of it away.
    assert configure(client, api_key="abc12")["api_key_hint"] is None


def test_ai_settings_validation(client):
    for base_url in ("ftp://llm.example.com", "llm.example.com/v1", "https://", ""):
        response = client.put(SETTINGS, json={"base_url": base_url, "model": "m"})
        body = assert_envelope(response, 422, "VALIDATION_ERROR")
        assert body["details"]["errors"][0]["field"] == "body.base_url"
    assert_envelope(
        client.put(SETTINGS, json={"base_url": "https://x.example", "model": " "}),
        422,
        "VALIDATION_ERROR",
    )
    rejected = client.put(
        SETTINGS, json={"base_url": "https://x.example", "model": "m", "api_key": KEY, "x": 1}
    )
    assert_envelope(rejected, 422, "VALIDATION_ERROR")
    assert KEY not in rejected.text
    # The key travels in a header: non-ASCII or inner spaces are refused when saving, not
    # left to fail on the first request.
    for bad_key in ("sk-全角ｋｅｙ", "sk-two words"):
        response = client.put(
            SETTINGS, json={"base_url": "https://x.example", "model": "m", "api_key": bad_key}
        )
        body = assert_envelope(response, 422, "VALIDATION_ERROR")
        assert body["details"]["errors"][0]["field"] == "body.api_key"
        assert bad_key not in response.text


def test_connection_test_success_and_request_shape(client, provider):
    """AC2: the test uses the saved configuration and reports the latency."""
    assert_envelope(client.post(f"{SETTINGS}/test"), 409, "AI_NOT_CONFIGURED")
    configure(client)
    response = client.post(f"{SETTINGS}/test")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["model"] == "gpt-test" and isinstance(body["latency_ms"], int)

    request = provider.requests[-1]
    assert str(request.url) == "https://llm.example.com/v1/chat/completions"
    assert request.headers["authorization"] == f"Bearer {KEY}"
    assert provider.body() == {
        "model": "gpt-test",
        "messages": [{"role": "user", "content": "ping"}],
    }

    # No key: no Authorization header at all (local servers).
    configure(client, api_key=None)
    assert client.post(f"{SETTINGS}/test").status_code == 200
    assert "authorization" not in provider.requests[-1].headers


def test_connection_test_failures(client, provider):
    """AC2: a rejected key, a missing endpoint, a timeout and an unreachable host each
    get their own Chinese reason; the key never appears, even if the provider echoes it."""
    configure(client)

    provider.reply = lambda request: httpx.Response(
        401, json={"error": {"message": f"Incorrect API key provided: {KEY}"}}
    )
    rejected = client.post(f"{SETTINGS}/test")
    body = assert_envelope(rejected, 502, "AI_PROVIDER_ERROR")
    assert body["message"] == "API Key 无效或无权限"
    assert body["details"]["status"] == 401
    assert "Incorrect API key" in body["details"]["provider_message"]
    assert KEY not in rejected.text

    provider.reply = lambda request: httpx.Response(404, text="Not Found")
    body = assert_envelope(client.post(f"{SETTINGS}/test"), 502, "AI_PROVIDER_ERROR")
    assert body["details"] == {"status": 404, "provider_message": "Not Found"}

    def timeout(request):
        raise httpx.ReadTimeout("timed out", request=request)

    provider.reply = timeout
    assert_envelope(client.post(f"{SETTINGS}/test"), 504, "AI_PROVIDER_TIMEOUT")

    def unreachable(request):
        raise httpx.ConnectError("connection refused", request=request)

    provider.reply = unreachable
    assert_envelope(client.post(f"{SETTINGS}/test"), 502, "AI_PROVIDER_ERROR")

    provider.reply = lambda request: httpx.Response(200, json={"choices": []})
    assert_envelope(client.post(f"{SETTINGS}/test"), 502, "AI_INVALID_RESPONSE")


def seed(ledger: Ledger) -> None:
    """September: groceries over budget, a matched refund, a note and an annual account."""
    insurance = ledger.budget_account("保险", period="year")
    protection = ledger.category("保障")
    life = ledger.category("寿险", protection, budget_account_id=insurance)
    ledger.set_budgets("2026-01", {ledger.groceries: "1000", ledger.dining: "800", life: "6000"})
    stored = ledger.submit(
        [
            ledger.item(
                date="2026-09-03",
                amount="1200",
                counterparty="盒马鲜生",
                description="月度采购",
                note="私人备注不外发",
            ),
            ledger.item(
                date="2026-09-10",
                amount="88",
                counterparty="海底捞",
                description="聚餐",
                category_id=ledger.dining,
            ),
            ledger.item(
                date="2026-09-12",
                amount="-30",
                counterparty="盒马鲜生",
                description="退款",
                refund_of_index=0,
            ),
            ledger.item(
                date="2026-03-01",
                amount="3000",
                counterparty="平安保险",
                description="年缴保费",
                category_id=life,
            ),
            ledger.item(
                date="2026-08-20", amount="500", counterparty="山姆会员店", description="八月采购"
            ),
        ]
    )
    assert stored.status_code == 201, stored.text


def test_generate_sends_summaries_and_transactions_without_note_channel_or_ids(
    client, ledger, provider
):
    """AC7: the request carries the category rows, the trend, the annual accounts and the
    month's transactions with counterparty and description, and no note, channel or id."""
    seed(ledger)
    configure(client)
    response = client.post(INSIGHT)
    assert response.status_code == 200, response.text

    body = provider.body()
    assert body["model"] == "gpt-test" and set(body) == {"model", "messages"}
    assert [m["role"] for m in body["messages"]] == ["system", "user"]
    data = provider.data()
    assert data["currency"] == "CNY" and data["month"] == MONTH

    detail = data["month_detail"]
    assert (detail["budget"], detail["actual"], detail["count"]) == ("1800.00", "1258.00", 2)
    food = next(row for row in detail["categories"] if row["name"] == "餐饮")
    assert {c["name"]: c["actual"] for c in food["children"]} == {
        "买菜": "1170.00",
        "外食": "88.00",
    }

    assert [p["month"] for p in data["trend"]] == [
        format_month(add_months(date(2026, 9, 1), -i)) for i in range(11, -1, -1)
    ]
    assert data["trend"][-2] == {
        "month": "2026-08",
        "budget": "1800.00",
        "actual": "500.00",
        "annual_actual": "0.00",
    }
    assert data["annual_accounts"] == [
        {
            "name": "保险",
            "budget": "6000.00",
            "actual": "3000.00",
            "count": 1,
            "months": [
                {"month": f"2026-{m:02d}", "actual": "3000.00" if m == 3 else "0.00"}
                for m in range(1, 10)
            ],
        }
    ]

    assert data["transactions"]["total"] == 3 and data["transactions"]["included"] == 3
    assert data["transactions"]["items"] == [
        {
            "date": "2026-09-03",
            "amount": "1200.00",
            "category": "餐饮/买菜",
            "counterparty": "盒马鲜生",
            "description": "月度采购",
            "refund": False,
            "refunded": "30.00",
        },
        {
            "date": "2026-09-10",
            "amount": "88.00",
            "category": "餐饮/外食",
            "counterparty": "海底捞",
            "description": "聚餐",
            "refund": False,
            "refunded": None,
        },
        {
            "date": "2026-09-12",
            "amount": "-30.00",
            "category": "餐饮/买菜",
            "counterparty": "盒马鲜生",
            "description": "退款",
            "refund": True,
            "refunded": None,
        },
    ]
    sent = json.dumps(body, ensure_ascii=False)
    assert "私人备注不外发" not in sent and "储蓄卡" not in sent
    forbidden = [key for key in keys_of(data) if key.endswith("id") or key in {"note", "channel"}]
    assert forbidden == []


def keys_of(value) -> list[str]:
    """Every object key anywhere in a JSON value."""
    if isinstance(value, dict):
        return [k for key, item in value.items() for k in (key, *keys_of(item))]
    if isinstance(value, list):
        return [k for item in value for k in keys_of(item)]
    return []


def test_generated_insight_is_cached_and_read_without_calling_the_model(client, ledger, provider):
    """AC4, AC8: a fenced answer after a <think> block is parsed; GET returns the stored
    insight with its model and time and never calls the model."""
    seed(ledger)
    before = client.get(INSIGHT).json()
    assert before == {"month": MONTH, "configured": False, "insight": None, "stale": False}

    configure(client)
    fenced = (
        "<think>先算预算……</think>\n```json\n" + json.dumps(CONTENT, ensure_ascii=False) + "\n```"
    )
    provider.reply = lambda request: provider.content(fenced)
    generated = client.post(INSIGHT)
    assert generated.status_code == 200, generated.text
    state = generated.json()
    assert state["configured"] is True and state["stale"] is False
    insight = state["insight"]
    assert insight["summary"] == CONTENT["summary"]
    assert insight["month_points"] == CONTENT["month_points"]
    assert insight["year_points"] == CONTENT["year_points"]
    assert insight["model"] == "gpt-test" and insight["generated_at"]

    calls = len(provider.requests)
    assert client.get(INSIGHT).json() == state
    assert len(provider.requests) == calls
    # Another month has its own (empty) slot.
    assert client.get(f"{API}/insights/2026-08").json()["insight"] is None


def test_invalid_answers_keep_the_previous_insight(client, ledger, provider):
    """AC8: an answer that is not JSON, or JSON of the wrong shape, is AI_INVALID_RESPONSE
    and the stored insight stays as it was."""
    seed(ledger)
    configure(client)
    stored = client.post(INSIGHT).json()

    for text in (
        "我无法回答。",
        json.dumps({"summary": "", "month_points": [], "year_points": []}),
        json.dumps(
            {"summary": "x", "month_points": [{"tone": "bad", "text": "y"}], "year_points": []}
        ),
    ):
        provider.reply = lambda request, text=text: provider.content(text)
        assert_envelope(client.post(INSIGHT), 502, "AI_INVALID_RESPONSE")
        assert client.get(INSIGHT).json() == stored

    provider.reply = lambda request: httpx.Response(500, text="boom")
    assert_envelope(client.post(INSIGHT), 502, "AI_PROVIDER_ERROR")
    assert client.get(INSIGHT).json() == stored


def test_points_are_capped_at_five(client, ledger, provider):
    seed(ledger)
    configure(client)
    many = {**CONTENT, "month_points": [{"tone": "neutral", "text": f"第{i}条"} for i in range(8)]}
    provider.reply = lambda request: provider.content(json.dumps(many, ensure_ascii=False))
    insight = client.post(INSIGHT).json()["insight"]
    assert [p["text"] for p in insight["month_points"]] == [f"第{i}条" for i in range(5)]


def test_insight_turns_stale_when_the_month_data_changes(client, ledger, provider):
    """AC5: a new transaction or a budget change marks the insight stale; regenerating
    clears the mark. Another month's change does not."""
    seed(ledger)
    configure(client)
    client.post(INSIGHT)
    assert client.get(INSIGHT).json()["stale"] is False

    later = ledger.submit([ledger.item(date="2026-10-01", amount="9", counterparty="便利店")])
    assert later.status_code == 201
    assert client.get(INSIGHT).json()["stale"] is False

    added = ledger.submit([ledger.item(date="2026-09-20", amount="15", counterparty="便利店")])
    assert added.status_code == 201
    assert client.get(INSIGHT).json()["stale"] is True

    regenerated = client.post(INSIGHT).json()
    assert regenerated["stale"] is False
    assert client.get(INSIGHT).json()["stale"] is False

    ledger.set_budgets("2026-09", {ledger.dining: "900"})
    assert client.get(INSIGHT).json()["stale"] is True

    # Changing the model does not mark it stale: stale means "your data changed".
    client.post(INSIGHT)
    configure(client, model="another-model")
    assert client.get(INSIGHT).json()["stale"] is False


def test_transactions_are_capped_by_absolute_amount(client, ledger, provider, monkeypatch):
    """R5: beyond the cap only the largest amounts are sent, re-sorted by date, and the
    model is told the total."""
    monkeypatch.setattr(insights, "MAX_TRANSACTIONS", 2)
    configure(client)
    stored = ledger.submit(
        [
            ledger.item(date="2026-09-01", amount="10", counterparty="甲"),
            ledger.item(date="2026-09-02", amount="300", counterparty="乙"),
            ledger.item(date="2026-09-03", amount="-200", counterparty="丙"),
            ledger.item(date="2026-09-04", amount="50", counterparty="丁"),
        ]
    )
    assert stored.status_code == 201, stored.text
    assert client.post(INSIGHT).status_code == 200
    sent = provider.data()["transactions"]
    assert (sent["total"], sent["included"]) == (4, 2)
    assert [item["counterparty"] for item in sent["items"]] == ["乙", "丙"]


def test_generate_refusals(client, ledger, agent):
    """Not configured is 409; a future month is 422; agent tokens cannot reach any of it."""
    assert_envelope(client.post(INSIGHT), 409, "AI_NOT_CONFIGURED")
    configure(client)
    future = format_month(add_months(date.today().replace(day=1), 1))
    assert_envelope(client.post(f"{API}/insights/{future}"), 422, "INVALID_MONTH")
    assert_envelope(client.get(f"{API}/insights/{future}"), 422, "INVALID_MONTH")
    assert_envelope(client.get(f"{API}/insights/2026-9"), 422, "VALIDATION_ERROR")

    for method, path in (
        ("GET", SETTINGS),
        ("PUT", SETTINGS),
        ("POST", f"{SETTINGS}/test"),
        ("GET", INSIGHT),
        ("POST", INSIGHT),
    ):
        response = agent.request(method, path, json=None if method == "GET" else {})
        assert_envelope(response, 403, "TOKEN_SCOPE_FORBIDDEN")


def test_generate_needs_the_base_currency(client, provider):
    configure(client)
    assert_envelope(client.post(INSIGHT), 409, "SETTINGS_NOT_INITIALIZED")
    assert provider.requests == []


def test_parse_json_content_tolerates_fences_and_think_blocks():
    raw = json.dumps(CONTENT, ensure_ascii=False)
    for text in (
        raw,
        f"```json\n{raw}\n```",
        f"```\n{raw}\n```",
        f"<think>\n推理\n</think>\n\n{raw}",
        f"好的，结果如下：\n{raw}\n以上。",
    ):
        assert ai_client.parse_json_content(text) == CONTENT
    with pytest.raises(Exception) as caught:
        ai_client.parse_json_content("```json\nnot json\n```")
    assert getattr(caught.value, "code", None) == "AI_INVALID_RESPONSE"
