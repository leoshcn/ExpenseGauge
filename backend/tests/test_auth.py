"""AC2 (single user setup), AC4 (auth scopes), AC5 (token lifecycle), error envelope."""

import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from sqlalchemy import text

from tests.conftest import PASSWORD, make_token

API = "/api/v1"

# (method, path template) reachable without credentials.
PUBLIC = {
    ("GET", f"{API}/health"),
    ("GET", f"{API}/setup/status"),
    ("POST", f"{API}/setup"),
    ("POST", f"{API}/auth/login"),
    ("POST", f"{API}/auth/logout"),
}
# The only operations an agent token may perform.
AGENT_ALLOWED = {
    ("GET", f"{API}/channels"),
    ("GET", f"{API}/categories"),
    ("GET", f"{API}/budgets"),
    ("GET", f"{API}/payments/search"),
    ("POST", f"{API}/channels/{{channel_id}}/transactions/batch"),
}


def _routes(app) -> list[tuple[str, str]]:
    """Every REST operation, read from the OpenAPI document the app generates."""
    return sorted(
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    )


def _call(http: TestClient, method: str, template: str):
    path = (
        template.replace("{channel_id}", "1")
        .replace("{budget_account_id}", "1")
        .replace("{category_id}", "1")
        .replace("{transaction_id}", "1")
        .replace("{token_id}", "1")
        .replace("{month}", "2026-09")
    )
    body = None if method in {"GET", "DELETE"} else {}
    return http.request(method, path, json=body)


def assert_envelope(response, status: int, code: str) -> dict:
    assert response.status_code == status, response.text
    body = response.json()
    assert set(body) == {"code", "message", "details"}
    assert body["code"] == code
    assert any("一" <= ch <= "鿿" for ch in body["message"]), "message must be Chinese"
    assert isinstance(body["details"], dict)
    return body


def test_health(anon):
    assert anon.get(f"{API}/health").json() == {"status": "ok"}


def test_setup_creates_the_only_user(anon):
    """AC2"""
    assert anon.get(f"{API}/setup/status").json() == {"user_exists": False}

    created = anon.post(f"{API}/setup", json={"username": "owner", "password": PASSWORD})
    assert created.status_code == 201
    assert created.json()["username"] == "owner"
    assert "password" not in created.text
    assert anon.get(f"{API}/setup/status").json() == {"user_exists": True}
    # Setup signs the user in.
    assert anon.get(f"{API}/auth/me").json()["username"] == "owner"

    again = anon.post(f"{API}/setup", json={"username": "second", "password": PASSWORD})
    assert_envelope(again, 409, "USER_ALREADY_EXISTS")


def test_concurrent_setup_creates_exactly_one_user(app):
    """AC2 under a race: simultaneous first-run requests cannot both pass the
    "no user yet" check."""
    workers = 6
    barrier = threading.Barrier(workers)

    def setup(number: int) -> int:
        http = TestClient(app)
        barrier.wait(timeout=10)
        response = http.post(
            f"{API}/setup", json={"username": f"owner{number}", "password": PASSWORD}
        )
        return response.status_code

    with ThreadPoolExecutor(max_workers=workers) as pool:
        statuses = sorted(pool.map(setup, range(workers)))
    assert statuses == [201] + [409] * (workers - 1)

    from app.db import get_engine

    with get_engine().connect() as connection:
        assert connection.scalar(text("SELECT count(*) FROM users")) == 1


def test_setup_validates_input(anon):
    response = anon.post(f"{API}/setup", json={"username": "owner", "password": "short"})
    body = assert_envelope(response, 422, "VALIDATION_ERROR")
    assert body["details"]["errors"][0]["field"] == "body.password"


def test_login_logout_and_cookie_flags(client, app):
    fresh = TestClient(app)
    wrong = fresh.post(f"{API}/auth/login", json={"username": "owner", "password": "nope-nope"})
    assert_envelope(wrong, 401, "INVALID_CREDENTIALS")
    unknown = fresh.post(f"{API}/auth/login", json={"username": "ghost", "password": PASSWORD})
    assert_envelope(unknown, 401, "INVALID_CREDENTIALS")

    ok = fresh.post(f"{API}/auth/login", json={"username": "owner", "password": PASSWORD})
    assert ok.status_code == 200
    cookie = ok.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "max-age=2592000" in cookie
    assert fresh.get(f"{API}/auth/me").status_code == 200

    session_value = fresh.cookies["eg_session"]
    assert fresh.post(f"{API}/auth/logout").status_code == 204
    # The server-side session is gone, not just the cookie.
    replay = TestClient(app, cookies={"eg_session": session_value})
    assert_envelope(replay.get(f"{API}/auth/me"), 401, "UNAUTHENTICATED")


def test_password_and_session_are_stored_hashed(client, app):
    from app.db import get_engine

    with get_engine().connect() as connection:
        password_hash = connection.scalar(text("SELECT password_hash FROM users"))
        session_id = connection.scalar(text("SELECT id FROM sessions"))
    assert password_hash.startswith("$argon2")
    assert session_id != client.cookies["eg_session"] and len(session_id) == 64


def test_session_expires_and_slides(client, app):
    from app.db import get_engine

    def set_expiry(delta: timedelta) -> None:
        with get_engine().begin() as connection:
            connection.execute(
                text("UPDATE sessions SET expires_at = :at"), {"at": datetime.now(UTC) + delta}
            )

    set_expiry(timedelta(days=10))
    refreshed = client.get(f"{API}/auth/me")
    assert refreshed.status_code == 200 and "set-cookie" in refreshed.headers
    with get_engine().connect() as connection:
        expires_at = connection.scalar(text("SELECT expires_at FROM sessions"))
    assert expires_at > datetime.now(UTC) + timedelta(days=29)

    set_expiry(timedelta(seconds=-1))
    assert_envelope(client.get(f"{API}/auth/me"), 401, "UNAUTHENTICATED")


def test_route_walk_sees_every_registered_endpoint(app):
    """The auth tests below walk the OpenAPI document. This keeps that walk complete:
    an endpoint hidden with `include_in_schema=False` would otherwise escape them."""
    endpoints: list[APIRoute] = []
    other: set[str] = set()

    def collect(routes) -> None:
        for route in routes:
            included = getattr(route, "original_router", None)  # an included router
            if isinstance(route, APIRoute):
                endpoints.append(route)
            elif included is not None:
                collect(included.routes)
            else:
                other.add(route.path)

    collect(app.routes)
    assert all(route.include_in_schema for route in endpoints)
    assert sum(len(route.methods) for route in endpoints) == len(_routes(app))
    # Everything else the app serves: the API documentation (no data, no credentials
    # needed) and the MCP mount, which has its own Bearer check (tests/test_mcp.py).
    assert other == {"/api/openapi.json", "/api/docs", "/docs/oauth2-redirect", "/mcp"}


def test_every_non_setup_endpoint_rejects_unauthenticated(anon, app):
    """AC4, first half: checked against every registered route, so a new endpoint
    cannot be added unprotected without this failing."""
    protected = [route for route in _routes(app) if route not in PUBLIC]
    assert len(protected) >= 18
    for method, path in protected:
        assert_envelope(_call(anon, method, path), 401, "UNAUTHENTICATED")


def test_session_grants_access_everywhere(client, app):
    """AC4: a session cookie is never answered with 401/403."""
    for method, path in _routes(app):
        if (method, path) in PUBLIC:
            continue
        status = _call(client, method, path).status_code
        assert status not in {401, 403}, (method, path, status)


def test_agent_token_reaches_only_the_agent_operations(agent, app, ledger):
    """AC4, second half; R6: list channels, read categories and budgets, find payments
    (refund matching), submit a batch. Every other endpoint answers an agent token with
    403, refund candidates and editing a match included."""
    routes = [route for route in _routes(app) if route not in PUBLIC]
    assert set(routes) >= AGENT_ALLOWED
    for method, path in routes:
        response = _call(agent, method, path)
        if (method, path) in AGENT_ALLOWED:
            assert response.status_code not in {401, 403}, (method, path)
        else:
            assert_envelope(response, 403, "TOKEN_SCOPE_FORBIDDEN")

    assert agent.get(f"{API}/channels").json() == [{"id": ledger.channel, "name": "储蓄卡"}]
    assert agent.get(f"{API}/categories").status_code == 200
    assert agent.get(f"{API}/budgets").status_code == 200
    assert ledger.submit([ledger.item()], client=agent).status_code == 201
    search = {"date_from": "2026-09-01", "date_to": "2026-09-30"}
    assert len(agent.get(f"{API}/payments/search", params=search).json()["payments"]) == 1


def test_token_wins_over_cookie(client, token):
    """A request presenting a token is scoped as a token even with a valid cookie."""
    response = client.get(f"{API}/settings", headers={"Authorization": f"Bearer {token['token']}"})
    assert_envelope(response, 403, "TOKEN_SCOPE_FORBIDDEN")


@pytest.mark.parametrize("header", ["Bearer eg_not-a-real-token", "Bearer", "Basic abc", "eg_x"])
def test_invalid_bearer_is_401(anon, header):
    response = anon.get(f"{API}/categories", headers={"Authorization": header})
    assert_envelope(response, 401, "INVALID_TOKEN")


def test_token_shown_once_then_revoked(client, app, ledger):
    """AC5"""
    created = make_token(client, "hermes")
    raw = created["token"]
    assert raw.startswith("eg_") and len(raw) > 40

    listed = client.get(f"{API}/tokens")
    assert listed.status_code == 200
    assert [t["name"] for t in listed.json()] == ["hermes"]
    assert "token" not in listed.json()[0] and "token_hash" not in listed.json()[0]
    assert raw not in listed.text

    from app.db import get_engine

    with get_engine().connect() as connection:
        stored = connection.scalar(text("SELECT token_hash FROM api_tokens"))
    assert stored != raw and len(stored) == 64

    agent = TestClient(app, headers={"Authorization": f"Bearer {raw}"})
    assert agent.get(f"{API}/categories").status_code == 200
    assert client.get(f"{API}/tokens").json()[0]["last_used_at"] is not None

    assert client.delete(f"{API}/tokens/{created['id']}").status_code == 204
    assert_envelope(agent.get(f"{API}/categories"), 401, "INVALID_TOKEN")
    assert client.get(f"{API}/tokens").json()[0]["revoked_at"] is not None
    assert_envelope(client.delete(f"{API}/tokens/999"), 404, "TOKEN_NOT_FOUND")


def test_state_changing_requests_must_be_json(client):
    """CSRF guard: a cross-site form post cannot be application/json."""
    response = client.post(
        f"{API}/channels",
        content="name=x",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    assert_envelope(response, 415, "UNSUPPORTED_MEDIA_TYPE")
    response = client.put(f"{API}/settings", content='{"currency":"CNY"}')
    assert_envelope(response, 415, "UNSUPPORTED_MEDIA_TYPE")


def test_unstorable_input_is_a_client_error_not_a_500(client, agent, ledger):
    """PostgreSQL cannot store U+0000 in text or an id beyond INTEGER; both must be
    answered with the envelope of a normal rejection, for the agent-reachable
    endpoints as well."""
    for name in ("channels", "budget-accounts", "tokens", "categories"):
        response = client.post(f"{API}/{name}", json={"name": "a\x00b"})
        assert_envelope(response, 422, "VALIDATION_ERROR")
    nul_login = client.post(f"{API}/auth/login", json={"username": "a\x00b", "password": "x"})
    assert_envelope(nul_login, 422, "VALIDATION_ERROR")

    huge = 2**31
    batch = agent.post(f"{API}/channels/{huge}/transactions/batch", json={"items": [ledger.item()]})
    assert_envelope(batch, 404, "CHANNEL_NOT_FOUND")
    scoped = {"budget_account_id": huge}
    assert_envelope(agent.get(f"{API}/categories", params=scoped), 422, "BUDGET_ACCOUNT_NOT_FOUND")
    assert_envelope(agent.get(f"{API}/budgets", params=scoped), 422, "BUDGET_ACCOUNT_NOT_FOUND")
    monthly = client.get(f"{API}/summary/monthly", params=scoped)
    assert_envelope(monthly, 422, "BUDGET_ACCOUNT_NOT_FOUND")
    listed = client.get(f"{API}/transactions", params={"channel_id": huge})
    assert_envelope(listed, 422, "CHANNEL_NOT_FOUND")
    renamed = client.patch(f"{API}/budget-accounts/{huge}", json={"name": "x"})
    assert_envelope(renamed, 404, "BUDGET_ACCOUNT_NOT_FOUND")
    assert_envelope(
        client.patch(f"{API}/channels/{huge}", json={"name": "x"}), 404, "CHANNEL_NOT_FOUND"
    )
    assert_envelope(
        client.patch(f"{API}/transactions/{huge}", json={"note": "x"}),
        404,
        "TRANSACTION_NOT_FOUND",
    )
    assert_envelope(client.delete(f"{API}/categories/{huge}"), 404, "CATEGORY_NOT_FOUND")
    assert_envelope(client.delete(f"{API}/tokens/{huge}"), 404, "TOKEN_NOT_FOUND")
    parent = client.post(
        f"{API}/categories", json={"name": "x", "parent_id": huge, "budget_account_id": huge}
    )
    assert_envelope(parent, 422, "INVALID_PARENT")
    leaf = client.post(
        f"{API}/categories",
        json={"name": "x", "parent_id": ledger.food, "budget_account_id": huge},
    )
    assert_envelope(leaf, 422, "BUDGET_ACCOUNT_NOT_FOUND")


def test_unknown_route_and_method_use_the_envelope(client):
    assert_envelope(client.get(f"{API}/nope"), 404, "NOT_FOUND")
    assert_envelope(client.delete(f"{API}/channels"), 405, "METHOD_NOT_ALLOWED")
    assert_envelope(client.get("/nope"), 404, "NOT_FOUND")
