"""AC16: the three MCP tools over real HTTP at /mcp, with the official SDK client and a
Bearer token, return the same results and rejections as the REST endpoints."""

import asyncio
import json
import socket
import threading
import time
from collections.abc import Iterator

import httpx
import httpx2
import pytest
import uvicorn
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from sqlalchemy import text

from tests.test_auth import API, assert_envelope


@pytest.fixture(scope="module")
def server_url(migrated_database: str) -> Iterator[str]:
    """The full application (REST + mounted MCP app) served by uvicorn on a local port."""
    from app.main import create_app

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    server = uvicorn.Server(
        uvicorn.Config(create_app(), host="127.0.0.1", port=port, log_level="warning")
    )
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 20
    while not server.started:
        assert thread.is_alive() and time.monotonic() < deadline, "uvicorn did not start"
        time.sleep(0.05)
    yield f"http://127.0.0.1:{port}"
    server.should_exit = True
    thread.join(timeout=10)


def run_mcp(url: str, token: str, calls):
    """Opens an MCP client session against `url` and runs `calls(client)`."""

    async def main():
        headers = {"Authorization": f"Bearer {token}"}
        async with (
            httpx2.AsyncClient(headers=headers, timeout=30) as http,
            Client(streamable_http_client(url, http_client=http)) as mcp_client,
        ):
            return await calls(mcp_client)

    return asyncio.run(main())


def call(url: str, token: str, name: str, arguments: dict):
    async def calls(mcp_client):
        return await mcp_client.call_tool(name, arguments)

    return run_mcp(url, token, calls)


def test_exactly_three_tools(server_url, token):
    async def calls(mcp_client):
        return await mcp_client.list_tools()

    tools = {tool.name: tool for tool in run_mcp(f"{server_url}/mcp", token["token"], calls).tools}
    assert set(tools) == {"list_categories", "get_budgets", "submit_transactions"}
    assert set(tools["get_budgets"].input_schema["properties"]) == {"account_id", "month"}
    item_schema = tools["submit_transactions"].input_schema["properties"]["items"]["items"]
    assert {"date", "amount", "counterparty", "category_id", "confirm_duplicate"} <= set(
        item_schema["properties"]
    )


@pytest.mark.parametrize("path", ["/mcp", "/mcp/"])
def test_read_tools_return_the_rest_payloads(server_url, client, token, ledger, path):
    ledger.set_budgets("2026-09", {ledger.groceries: "1200", ledger.metro: "0"})
    url = server_url + path

    categories = call(url, token["token"], "list_categories", {"account_id": ledger.account_id})
    assert categories.is_error is False
    assert categories.structured_content == client.get(f"{ledger.base}/categories").json()
    assert json.loads(categories.content[0].text) == categories.structured_content

    budgets = call(
        url, token["token"], "get_budgets", {"account_id": ledger.account_id, "month": "2026-10"}
    )
    rest = client.get(f"{ledger.base}/budgets", params={"month": "2026-10"}).json()
    assert budgets.structured_content == rest
    assert {line["amount"] for line in rest["budgets"]} == {"1200.00", None, "0.00"}

    default_month = call(url, token["token"], "get_budgets", {"account_id": ledger.account_id})
    assert default_month.structured_content == client.get(f"{ledger.base}/budgets").json()


def test_submit_transactions_matches_rest(server_url, client, token, ledger):
    url = f"{server_url}/mcp"
    arguments = {
        "account_id": ledger.account_id,
        "items": [ledger.item(), ledger.item(counterparty="海底捞", category_id=ledger.dining)],
    }
    accepted = call(url, token["token"], "submit_transactions", arguments)
    assert accepted.is_error is False
    body = accepted.structured_content
    assert body["accepted"] is True and len(body["transactions"]) == 2
    listed = client.get(f"{ledger.base}/transactions").json()
    assert listed["total"] == 2
    assert sorted(t["id"] for t in listed["items"]) == [t["id"] for t in body["transactions"]]
    from app.db import get_engine

    with get_engine().connect() as connection:
        assert set(connection.scalars(text("SELECT api_token_id FROM transactions"))) == {
            token["id"]
        }

    # A rejected batch: the same feedback as REST, as a normal (non-error) tool result.
    rejected_items = [
        ledger.item(),  # stored above -> SUSPECTED_DUPLICATE
        ledger.item(counterparty="新商户", category_id=ledger.food),  # CATEGORY_NOT_LEAF
        ledger.item(counterparty="新商户2", category_id=424242),  # CATEGORY_NOT_FOUND
        ledger.item(counterparty="新商户3"),
        ledger.item(counterparty="新商户3"),  # DUPLICATE_IN_BATCH
        ledger.item(counterparty="新商户4", amount="abc"),  # INVALID_FIELD
    ]
    rest = ledger.submit(rejected_items)
    rest_body = assert_envelope(rest, 409, "BATCH_REJECTED")
    rejected = call(
        url, token["token"], "submit_transactions", {**arguments, "items": rejected_items}
    )
    assert rejected.is_error is False
    assert rejected.structured_content == {"accepted": False, **rest_body}
    codes = [entry.get("code") for entry in rejected.structured_content["details"]["items"]]
    assert codes == [
        "SUSPECTED_DUPLICATE",
        "CATEGORY_NOT_LEAF",
        "CATEGORY_NOT_FOUND",
        None,
        "DUPLICATE_IN_BATCH",
        "INVALID_FIELD",
    ]
    assert client.get(f"{ledger.base}/transactions").json()["total"] == 2

    confirmed = call(
        url,
        token["token"],
        "submit_transactions",
        {"account_id": ledger.account_id, "items": [ledger.item(confirm_duplicate=True)]},
    )
    assert confirmed.structured_content["transactions"][0]["confirmed_duplicate"] is True
    assert client.get(f"{ledger.base}/transactions").json()["total"] == 3


def test_other_failures_are_tool_errors_with_the_rest_envelope(server_url, client, token, ledger):
    url = f"{server_url}/mcp"
    missing = call(url, token["token"], "list_categories", {"account_id": 999})
    assert missing.is_error is True
    rest = assert_envelope(client.get(f"{API}/accounts/999/categories"), 404, "ACCOUNT_NOT_FOUND")
    assert missing.structured_content == rest
    assert json.loads(missing.content[0].text) == rest

    # An id PostgreSQL's INTEGER cannot hold is "not found" here too, not a crash.
    beyond = call(url, token["token"], "get_budgets", {"account_id": 2**31})
    assert beyond.is_error is True
    assert beyond.structured_content == rest

    bad_month = call(
        url, token["token"], "get_budgets", {"account_id": ledger.account_id, "month": "2026-13"}
    )
    assert bad_month.is_error is True
    assert bad_month.structured_content["code"] == "INVALID_MONTH"

    empty = call(
        url, token["token"], "submit_transactions", {"account_id": ledger.account_id, "items": []}
    )
    assert empty.is_error is True
    assert empty.structured_content["code"] == "INVALID_BATCH_SIZE"


def test_mcp_requires_a_live_bearer_token(server_url, client, token, ledger):
    url = f"{server_url}/mcp"
    request = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    headers = {"Accept": "application/json, text/event-stream"}

    assert_envelope(httpx.post(url, json=request, headers=headers), 401, "INVALID_TOKEN")
    bad = httpx.post(url, json=request, headers={**headers, "Authorization": "Bearer eg_nope"})
    assert_envelope(bad, 401, "INVALID_TOKEN")
    # The session cookie is not accepted on /mcp.
    cookie_only = httpx.post(url, json=request, headers=headers, cookies=dict(client.cookies))
    assert_envelope(cookie_only, 401, "INVALID_TOKEN")
    assert_envelope(httpx.get(url, headers=headers), 401, "INVALID_TOKEN")

    arguments = {"account_id": ledger.account_id}
    assert call(url, token["token"], "list_categories", arguments).is_error is False
    assert client.delete(f"{API}/tokens/{token['id']}").status_code == 204
    revoked = httpx.post(
        url, json=request, headers={**headers, "Authorization": f"Bearer {token['token']}"}
    )
    assert_envelope(revoked, 401, "INVALID_TOKEN")
    with pytest.raises(Exception):  # noqa: B017 - the SDK surfaces the 401 as a transport error
        call(url, token["token"], "list_categories", arguments)
