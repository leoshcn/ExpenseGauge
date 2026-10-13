"""AC16 / R6: the MCP tools over real HTTP at /mcp, with the official SDK client and
a Bearer token, return the same results and rejections as the REST endpoints."""

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


def test_exactly_five_tools(server_url, token):
    async def calls(mcp_client):
        return await mcp_client.list_tools()

    tools = {tool.name: tool for tool in run_mcp(f"{server_url}/mcp", token["token"], calls).tools}
    assert set(tools) == {
        "list_channels",
        "list_categories",
        "get_budgets",
        "find_payments",
        "submit_transactions",
    }
    assert set(tools["find_payments"].input_schema["properties"]) == {
        "date_from",
        "date_to",
        "channel_id",
        "counterparty",
        "limit",
    }
    assert set(tools["find_payments"].input_schema["required"]) == {"date_from", "date_to"}
    assert set(tools["list_channels"].input_schema.get("properties", {})) == set()
    assert set(tools["list_categories"].input_schema.get("properties", {})) == set()
    assert set(tools["get_budgets"].input_schema["properties"]) == {"month", "budget_account_id"}
    submit = tools["submit_transactions"].input_schema
    assert set(submit["properties"]) == {"channel_id", "items"}
    item_schema = submit["properties"]["items"]["items"]
    assert {
        "date",
        "amount",
        "counterparty",
        "category_id",
        "confirm_duplicate",
        "refund_of_id",
        "refund_of_index",
    } <= set(item_schema["properties"])


def test_find_payments_then_submit_a_matched_refund(server_url, client, token, ledger):
    """AC6, AC7 over MCP: find_payments returns payments only, as REST does; a refund
    submitted with the found id is stored matched; a bad match is the same per-item
    feedback as over REST."""
    url = f"{server_url}/mcp"
    stored = ledger.submit(
        [
            ledger.item(date="2026-09-01", amount="100", counterparty="盒马"),
            ledger.item(date="2026-09-02", amount="-5", counterparty="盒马"),
        ]
    )
    assert stored.status_code == 201
    payment = stored.json()["transactions"][0]
    arguments = {"date_from": "2026-09-01", "date_to": "2026-09-30", "counterparty": "盒马"}

    found = call(url, token["token"], "find_payments", arguments)
    assert found.is_error is False
    rest = client.get(f"{API}/payments/search", params=arguments).json()
    assert found.structured_content == rest
    assert [p["id"] for p in rest["payments"]] == [payment["id"]]  # not the refund
    assert rest["payments"][0]["refundable"] == "100.00"

    refund = ledger.item(
        date="2026-09-10", amount="-30", counterparty="盒马退款", refund_of_id=payment["id"]
    )
    accepted = call(
        url,
        token["token"],
        "submit_transactions",
        {"channel_id": ledger.channel, "items": [refund]},
    )
    assert accepted.structured_content["accepted"] is True
    assert accepted.structured_content["transactions"][0]["refund_of"]["id"] == payment["id"]
    again = call(url, token["token"], "find_payments", arguments).structured_content
    assert (again["payments"][0]["refunded"], again["payments"][0]["refundable"]) == (
        "30.00",
        "70.00",
    )

    too_much = [
        ledger.item(
            date="2026-09-11", amount="-71", counterparty="超额", refund_of_id=payment["id"]
        )
    ]
    rest_rejected = assert_envelope(ledger.submit(too_much), 409, "BATCH_REJECTED")
    rejected = call(
        url,
        token["token"],
        "submit_transactions",
        {"channel_id": ledger.channel, "items": too_much},
    )
    assert rejected.structured_content == {"accepted": False, **rest_rejected}
    assert rest_rejected["details"]["items"][0]["code"] == "REFUND_EXCEEDS_PAYMENT"

    wide = {"date_from": "2025-01-01", "date_to": "2026-09-30"}
    error = call(url, token["token"], "find_payments", wide)
    assert error.is_error is True
    rest_error = client.get(f"{API}/payments/search", params=wide)
    assert error.structured_content == assert_envelope(rest_error, 422, "INVALID_DATE_RANGE")


@pytest.mark.parametrize("path", ["/mcp", "/mcp/"])
def test_read_tools_return_the_rest_payloads(server_url, client, token, ledger, path):
    fixed = ledger.budget_account("固定")
    housing = ledger.category("居住")
    ledger.category("房租", housing, fixed)
    ledger.add_channel("信用卡")
    ledger.set_budgets("2026-09", {ledger.groceries: "1200", ledger.metro: "0"})
    client.patch(f"{API}/categories/{ledger.groceries}", json={"description": "线下商超\n不含外卖"})
    url = server_url + path

    channels = call(url, token["token"], "list_channels", {})
    assert channels.is_error is False
    assert channels.structured_content == {"channels": client.get(f"{API}/channels").json()}
    assert [c["name"] for c in channels.structured_content["channels"]] == ["储蓄卡", "信用卡"]

    categories = call(url, token["token"], "list_categories", {})
    assert categories.is_error is False
    assert categories.structured_content == client.get(f"{API}/categories").json()
    children = [c for node in categories.structured_content["categories"] for c in node["children"]]
    assert [c["description"] for c in children] == ["线下商超\n不含外卖", None, None, None]
    assert [c["budget_account"]["name"] for c in children] == ["日常", "日常", "日常", "固定"]
    assert json.loads(categories.content[0].text) == categories.structured_content

    budgets = call(url, token["token"], "get_budgets", {"month": "2026-10"})
    rest = client.get(f"{API}/budgets", params={"month": "2026-10"}).json()
    assert budgets.structured_content == rest
    assert {line["amount"] for line in rest["budgets"]} == {"1200.00", None, "0.00"}

    scoped = call(url, token["token"], "get_budgets", {"budget_account_id": fixed})
    rest = client.get(f"{API}/budgets", params={"budget_account_id": fixed}).json()
    assert scoped.structured_content == rest
    assert [line["category_name"] for line in rest["budgets"]] == ["房租"]

    default_month = call(url, token["token"], "get_budgets", {})
    assert default_month.structured_content == client.get(f"{API}/budgets").json()


def test_list_categories_follows_the_order_set_by_the_user(server_url, client, token, ledger):
    """AC4: the tool returns the tree in the display order, like the REST endpoint, and so
    does the `valid_categories` feedback of a rejected batch."""
    order = f"{API}/categories/order"
    top = {"parent_id": None, "ordered_ids": [ledger.transport, ledger.food]}
    assert client.put(order, json=top).status_code == 200
    food = {"parent_id": ledger.food, "ordered_ids": [ledger.dining, ledger.groceries]}
    assert client.put(order, json=food).status_code == 200
    url = f"{server_url}/mcp"

    categories = call(url, token["token"], "list_categories", {})
    assert categories.is_error is False
    tree = categories.structured_content
    assert tree == client.get(f"{API}/categories").json()
    assert [(n["name"], [c["name"] for c in n["children"]]) for n in tree["categories"]] == [
        ("交通", ["地铁"]),
        ("餐饮", ["外食", "买菜"]),
    ]

    arguments = {"channel_id": ledger.channel, "items": [ledger.item(category_id=999)]}
    rejected = call(url, token["token"], "submit_transactions", arguments)
    feedback = rejected.structured_content["details"]["items"][0]
    assert feedback["valid_categories"] == tree["categories"]


def test_get_budgets_reflects_a_cleared_budget(server_url, client, token, ledger):
    """AC12 over MCP: the tool returns the REST payload before and after the clearing."""
    ledger.set_budgets("2026-01", {ledger.groceries: "1000", ledger.metro: "0"})
    ledger.set_budgets("2026-06", {ledger.groceries: None})
    url = f"{server_url}/mcp"

    def amounts(month: str) -> dict[int, str | None]:
        result = call(url, token["token"], "get_budgets", {"month": month})
        assert result.is_error is False
        rest = client.get(f"{API}/budgets", params={"month": month}).json()
        assert result.structured_content == rest
        return {line["category_id"]: line["amount"] for line in rest["budgets"]}

    assert amounts("2026-05") == {
        ledger.groceries: "1000.00",
        ledger.dining: None,
        ledger.metro: "0.00",
    }
    assert amounts("2026-06") == {ledger.groceries: None, ledger.dining: None, ledger.metro: "0.00"}
    assert amounts("2026-12") == amounts("2026-06")


def test_get_budgets_reports_the_period_of_each_line(server_url, client, token, ledger):
    """AC3 over MCP: each line carries its budget account's period, as over REST."""
    yearly = ledger.budget_account("年度", "year")
    insurance = ledger.category("保险", ledger.food, yearly)
    ledger.set_budgets("2026-08", {insurance: "12000", ledger.groceries: "1000"})
    result = call(f"{server_url}/mcp", token["token"], "get_budgets", {"month": "2026-03"})
    assert result.is_error is False
    assert (
        result.structured_content
        == client.get(f"{API}/budgets", params={"month": "2026-03"}).json()
    )
    lines = {line["category_id"]: line for line in result.structured_content["budgets"]}
    assert (lines[insurance]["period"], lines[insurance]["amount"]) == ("year", "12000.00")
    assert lines[insurance]["effective_from"] == "2026-01"
    assert (lines[ledger.groceries]["period"], lines[ledger.groceries]["amount"]) == ("month", None)


def test_submit_transactions_matches_rest(server_url, client, token, ledger):
    url = f"{server_url}/mcp"
    arguments = {
        "channel_id": ledger.channel,
        "items": [ledger.item(), ledger.item(counterparty="海底捞", category_id=ledger.dining)],
    }
    accepted = call(url, token["token"], "submit_transactions", arguments)
    assert accepted.is_error is False
    body = accepted.structured_content
    assert body["accepted"] is True and len(body["transactions"]) == 2
    assert {t["channel_id"] for t in body["transactions"]} == {ledger.channel}
    listed = client.get(f"{API}/transactions").json()
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
    assert client.get(f"{API}/transactions").json()["total"] == 2

    confirmed = call(
        url,
        token["token"],
        "submit_transactions",
        {"channel_id": ledger.channel, "items": [ledger.item(confirm_duplicate=True)]},
    )
    assert confirmed.structured_content["transactions"][0]["confirmed_duplicate"] is True
    assert client.get(f"{API}/transactions").json()["total"] == 3

    # The same item from another channel is not a duplicate.
    card = ledger.add_channel("信用卡")
    other = call(
        url, token["token"], "submit_transactions", {"channel_id": card, "items": [ledger.item()]}
    )
    assert other.structured_content["accepted"] is True
    assert client.get(f"{API}/transactions").json()["total"] == 4


def test_other_failures_are_tool_errors_with_the_rest_envelope(server_url, client, token, ledger):
    url = f"{server_url}/mcp"
    item = ledger.item()
    missing = call(url, token["token"], "submit_transactions", {"channel_id": 999, "items": [item]})
    assert missing.is_error is True
    rest = assert_envelope(ledger.submit([item], channel_id=999), 404, "CHANNEL_NOT_FOUND")
    assert missing.structured_content == rest
    assert json.loads(missing.content[0].text) == rest

    # An id PostgreSQL's INTEGER cannot hold is "not found" here too, not a crash.
    beyond = call(
        url, token["token"], "submit_transactions", {"channel_id": 2**31, "items": [item]}
    )
    assert beyond.is_error is True
    assert beyond.structured_content == rest

    unknown_account = call(url, token["token"], "get_budgets", {"budget_account_id": 999})
    assert unknown_account.is_error is True
    rest = client.get(f"{API}/budgets", params={"budget_account_id": 999})
    assert unknown_account.structured_content == assert_envelope(
        rest, 422, "BUDGET_ACCOUNT_NOT_FOUND"
    )

    bad_month = call(url, token["token"], "get_budgets", {"month": "2026-13"})
    assert bad_month.is_error is True
    assert bad_month.structured_content["code"] == "INVALID_MONTH"

    empty = call(
        url, token["token"], "submit_transactions", {"channel_id": ledger.channel, "items": []}
    )
    assert empty.is_error is True
    assert empty.structured_content["code"] == "INVALID_BATCH_SIZE"


def test_get_budgets_before_the_currency_is_set(server_url, client, token):
    """Before onboarding sets the base currency the tool reports the REST error."""
    result = call(f"{server_url}/mcp", token["token"], "get_budgets", {})
    assert result.is_error is True
    rest = assert_envelope(client.get(f"{API}/budgets"), 409, "SETTINGS_NOT_INITIALIZED")
    assert result.structured_content == rest
    channels = call(f"{server_url}/mcp", token["token"], "list_channels", {})
    assert channels.structured_content == {"channels": []}


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

    assert call(url, token["token"], "list_categories", {}).is_error is False
    assert client.delete(f"{API}/tokens/{token['id']}").status_code == 204
    revoked = httpx.post(
        url, json=request, headers={**headers, "Authorization": f"Bearer {token['token']}"}
    )
    assert_envelope(revoked, 401, "INVALID_TOKEN")
    with pytest.raises(Exception):  # noqa: B017 - the SDK surfaces the 401 as a transport error
        call(url, token["token"], "list_categories", {})
