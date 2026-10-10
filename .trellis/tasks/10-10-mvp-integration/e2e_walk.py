"""End-to-end walk of parent AC2-AC16 against a composed ExpenseGauge stack, over HTTP
through nginx. Needs a fresh stack with no user.

    cd backend
    uv run python ../.trellis/tasks/10-10-mvp-integration/e2e_walk.py walk   http://HOST:8080
    uv run python ../.trellis/tasks/10-10-mvp-integration/e2e_walk.py verify http://HOST:8080

`walk` writes a state file next to this script (throwaway credentials and expected
counts) that `verify` reads after a restart. The backend environment provides httpx,
httpx2 and the official `mcp` SDK (the same version the server uses).
"""

import asyncio
import json
import re
import secrets
import subprocess
import sys
from decimal import Decimal
from pathlib import Path
from typing import Any

import httpx
import httpx2
from mcp import Client
from mcp.client.streamable_http import streamable_http_client

HERE = Path(__file__).resolve().parent
STATE = HERE / "e2e_state.json"
SCREENSHOT = HERE / "e2e-dashboard.png"
CJK = re.compile(r"[一-鿿]")

results: list[dict[str, Any]] = []


def check(ac: str, what: str, ok: bool, evidence: Any = "") -> bool:
    results.append({"ac": ac, "what": what, "ok": bool(ok), "evidence": evidence})
    print(f"[{'PASS' if ok else 'FAIL'}] {ac} {what} :: {evidence}", flush=True)
    return bool(ok)


def code_of(response: httpx.Response) -> str | None:
    try:
        return response.json().get("code")
    except Exception:
        return None


def browser(base: str, *args: str) -> dict[str, Any]:
    proc = subprocess.run(
        ["node", str(HERE / "e2e_browser.mjs"), base, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=180,
        stdin=subprocess.DEVNULL,
    )
    line = (proc.stdout.strip().splitlines() or ["{}"])[-1]
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return {"ok": False, "error": proc.stdout + proc.stderr}


# --------------------------------------------------------------------------- MCP


async def _mcp(url: str, token: str, fn):
    headers = {"Authorization": f"Bearer {token}"}
    async with (
        httpx2.AsyncClient(headers=headers, timeout=60) as http,
        Client(streamable_http_client(url, http_client=http)) as client,
    ):
        return await fn(client)


def mcp_call(url: str, token: str, name: str, arguments: dict):
    return asyncio.run(_mcp(url, token, lambda c: c.call_tool(name, arguments)))


def mcp_tools(url: str, token: str):
    return asyncio.run(_mcp(url, token, lambda c: c.list_tools()))


# --------------------------------------------------------------------------- walk


def walk(base: str) -> None:
    api = f"{base}/api/v1"
    anon = httpx.Client(base_url=api, timeout=30)
    username = "e2e-owner"
    password = secrets.token_urlsafe(18)

    # ---- AC1 (reachability part) and AC2
    root = httpx.get(base + "/", timeout=30)
    check("AC1", "web UI served over the LAN", root.status_code == 200 and "<div id=\"root\"" in root.text,
          f"GET / -> {root.status_code} {root.headers.get('content-type')}")
    status = anon.get("/setup/status")
    check("AC2", "no user: setup status says so", status.json() == {"user_exists": False}, status.json())
    b = browser(base, "setup-redirect")
    check("AC2", "browser routes to user creation", b.get("ok") and b.get("url", "").endswith("/setup"),
          {k: b.get(k) for k in ("url", "browser", "error", "errors")})

    short = anon.post("/setup", json={"username": username, "password": "short"})
    check("AC2", "weak password rejected", short.status_code == 422, f"{short.status_code} {code_of(short)}")
    session = httpx.Client(base_url=api, timeout=30)
    created = session.post("/setup", json={"username": username, "password": password})
    check("AC2", "first user created and signed in",
          created.status_code == 201 and "eg_session" in session.cookies,
          f"{created.status_code}; Set-Cookie flags: "
          + "; ".join(p.strip() for p in created.headers.get("set-cookie", "").split(";")[1:]))
    again = anon.post("/setup", json={"username": "second", "password": "another-password"})
    check("AC2", "setup refuses a second user", again.status_code == 409 and code_of(again) == "USER_ALREADY_EXISTS",
          f"{again.status_code} {code_of(again)} {again.json().get('message')}")
    check("AC2", "setup status now true", anon.get("/setup/status").json() == {"user_exists": True})

    # ---- login
    bad = anon.post("/auth/login", json={"username": username, "password": "wrong-password"})
    check("AC4", "login with wrong password", bad.status_code == 401 and code_of(bad) == "INVALID_CREDENTIALS",
          f"{bad.status_code} {code_of(bad)}")
    user = httpx.Client(base_url=api, timeout=30)
    login = user.post("/auth/login", json={"username": username, "password": password})
    me = user.get("/auth/me")
    check("AC4", "login sets session; /auth/me works", login.status_code == 200 and me.json()["username"] == username,
          f"login {login.status_code}, me {me.status_code}")

    # ---- AC3
    check("AC3", "no account yet after setup", user.get("/accounts").json() == [])
    b = browser(base, "onboarding-redirect", username, password)
    check("AC3", "browser is sent to onboarding before the dashboard",
          b.get("ok") and b.get("url", "").endswith("/onboarding"), {k: b.get(k) for k in ("url", "error", "errors")})
    acc = user.post("/accounts", json={"name": "日常账户", "currency": "cny"}).json()
    A = acc["id"]
    check("AC3", "first account created (currency normalized)", acc["currency"] == "CNY", acc)

    def cat(account: int, name: str, parent: int | None = None) -> int:
        r = user.post(f"/accounts/{account}/categories", json={"name": name, "parent_id": parent})
        assert r.status_code == 201, r.text
        return r.json()["id"]

    food = cat(A, "餐饮")
    grocery = cat(A, "超市", food)
    takeout = cat(A, "外卖", food)
    transport = cat(A, "交通")
    metro = cat(A, "地铁", transport)
    shopping = cat(A, "购物")
    daily = cat(A, "日用", shopping)
    deep = user.post(f"/accounts/{A}/categories", json={"name": "三级", "parent_id": grocery})
    check("AC3", "categories are two levels only", deep.status_code == 422 and code_of(deep) == "INVALID_PARENT",
          f"{deep.status_code} {code_of(deep)}")
    B = user.post("/accounts", json={"name": "美元卡", "currency": "USD"}).json()["id"]
    travel = cat(B, "旅行")
    flights = cat(B, "机票", travel)

    # ---- AC4 unauthenticated
    public = {p: anon.get(p).status_code for p in ("/health",)}
    public["/api/docs"] = httpx.get(f"{base}/api/docs", timeout=30).status_code
    public["/api/openapi.json"] = httpx.get(f"{base}/api/openapi.json", timeout=30).status_code
    check("AC4", "health and API docs are public", set(public.values()) == {200}, public)
    protected = [
        ("GET", "/auth/me"), ("GET", "/tokens"), ("GET", "/accounts"),
        ("GET", f"/accounts/{A}/categories"), ("GET", f"/accounts/{A}/budgets"),
        ("GET", f"/accounts/{A}/transactions"), ("GET", f"/accounts/{A}/summary/monthly"),
        ("GET", f"/accounts/{A}/summary/months/2026-10"), ("POST", f"/accounts/{A}/transactions/batch"),
        ("PUT", f"/accounts/{A}/budgets"), ("DELETE", f"/categories/{grocery}"),
    ]
    unauth = {f"{m} {p}": anon.request(m, p, json={} if m in ("POST", "PUT") else None).status_code for m, p in protected}
    check("AC4", "every non-setup endpoint rejects unauthenticated requests",
          set(unauth.values()) == {401}, unauth)
    csrf = user.post("/accounts", content="name=x", headers={"Content-Type": "application/x-www-form-urlencoded"})
    check("AC4", "state change needs application/json (CSRF guard)",
          csrf.status_code == 415 and code_of(csrf) == "UNSUPPORTED_MEDIA_TYPE", f"{csrf.status_code} {code_of(csrf)}")

    # ---- AC5 tokens
    created_token = user.post("/tokens", json={"name": "e2e agent"})
    tok = created_token.json()
    token = tok["token"]
    check("AC5", "token shown at creation", created_token.status_code == 201 and token.startswith("eg_"),
          f"{created_token.status_code}, token prefix {token[:3]}, length {len(token)}")
    listed = user.get("/tokens").json()
    check("AC5", "token not retrievable afterwards", all("token" not in t for t in listed) and token not in json.dumps(listed),
          f"list keys: {sorted(listed[0])}")
    agent = httpx.Client(base_url=api, timeout=30, headers={"Authorization": f"Bearer {token}"})

    # ---- AC4 token scope
    allowed = {
        "GET categories": agent.get(f"/accounts/{A}/categories").status_code,
        "GET budgets": agent.get(f"/accounts/{A}/budgets").status_code,
    }
    check("AC4", "agent token allowed on the read operations", set(allowed.values()) == {200}, allowed)
    forbidden_calls = [
        ("GET", "/auth/me", None), ("GET", "/tokens", None), ("POST", "/tokens", {"name": "x"}),
        ("DELETE", f"/tokens/{tok['id']}", None), ("GET", "/accounts", None),
        ("POST", "/accounts", {"name": "x", "currency": "EUR"}), ("PATCH", f"/accounts/{A}", {"name": "x"}),
        ("POST", f"/accounts/{A}/categories", {"name": "x"}), ("PATCH", f"/categories/{grocery}", {"name": "x"}),
        ("DELETE", f"/categories/{daily}", None),
        ("PUT", f"/accounts/{A}/budgets", {"effective_from": "2026-10", "items": [{"category_id": grocery, "amount": "1"}]}),
        ("GET", f"/accounts/{A}/transactions", None), ("GET", f"/accounts/{A}/summary/monthly", None),
        ("GET", f"/accounts/{A}/summary/months/2026-10", None),
        ("PATCH", "/transactions/1", {"note": "x"}), ("DELETE", "/transactions/1", None),
    ]
    scope = {f"{m} {p}": (lambda r: f"{r.status_code} {code_of(r)}")(agent.request(m, p, json=body))
             for m, p, body in forbidden_calls}
    check("AC4", "agent token gets 403 everywhere else",
          all(v == "403 TOKEN_SCOPE_FORBIDDEN" for v in scope.values()), scope)
    check("AC4", "session cookie grants full access",
          all(user.get(p).status_code == 200 for p in ("/tokens", "/accounts", f"/accounts/{A}/transactions")))

    # ---- AC6 categories
    tree = agent.get(f"/accounts/{A}/categories").json()
    shape = {n["name"]: [c["name"] for c in n["children"]] for n in tree["categories"]}
    check("AC6", "list_categories (REST) returns the two-level tree",
          shape == {"餐饮": ["超市", "外卖"], "交通": ["地铁"], "购物": ["日用"]}, shape)

    # ---- AC12 budgets
    def put_budget(month: str, items: dict[int, str | None]) -> httpx.Response:
        return user.put(f"/accounts/{A}/budgets", json={
            "effective_from": month, "items": [{"category_id": k, "amount": v} for k, v in items.items()]})

    def budgets(month: str, client: httpx.Client = agent) -> dict[int, str | None]:
        body = client.get(f"/accounts/{A}/budgets", params={"month": month}).json()
        return {line["category_id"]: line["amount"] for line in body["budgets"]}

    r = put_budget("2026-08", {grocery: "1000", takeout: "500", metro: "0"})
    check("AC12", "set budgets from 2026-08", r.status_code == 200, r.status_code)
    july, aug = budgets("2026-07"), budgets("2026-08")
    check("AC6", "get_budgets per level-2 category for a month",
          aug == {grocery: "1000.00", takeout: "500.00", metro: "0.00", daily: None}, aug)
    check("AC12", "month before the first budget has none", set(july.values()) == {None}, july)
    put_budget("2026-10", {grocery: "1200"})
    put_budget("2026-10", {takeout: None})
    seq = {m: budgets(m) for m in ("2026-08", "2026-09", "2026-10", "2026-12")}
    check("AC12", "change from 2026-10 applies to 10 and later only",
          seq["2026-09"][grocery] == "1000.00" and seq["2026-10"][grocery] == "1200.00"
          and seq["2026-12"][grocery] == "1200.00", {m: v[grocery] for m, v in seq.items()})
    check("AC12", "clear from 2026-10 shows no budget for 10 and later, earlier kept",
          seq["2026-09"][takeout] == "500.00" and seq["2026-10"][takeout] is None and seq["2026-12"][takeout] is None,
          {m: v[takeout] for m, v in seq.items()})
    lvl1 = put_budget("2026-10", {food: "100"})
    check("AC12", "level-1 budget cannot be entered", lvl1.status_code == 422 and code_of(lvl1) == "CATEGORY_NOT_LEAF",
          f"{lvl1.status_code} {code_of(lvl1)}")

    # ---- AC7 valid batch (agent token, REST)
    def item(day: str, amount: str, cp: str, cat_id: int, desc: str = "POS 消费", **extra) -> dict:
        return {"date": day, "amount": amount, "counterparty": cp, "description": desc, "category_id": cat_id, **extra}

    batch = [
        item("2026-09-12", "300.00", "永辉超市", grocery),
        item("2026-09-20", "88.50", "美团外卖", takeout),
        item("2026-10-03", "86.40", "永辉超市", grocery),
        item("2026-10-05", "45.00", "饿了么", takeout, note="午饭"),
        item("2026-10-06", "6.00", "地铁", metro, desc="单程票"),
        item("2026-10-08", "129.90", "名创优品", daily),
    ]
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": batch})
    stored = r.json().get("transactions", [])
    check("AC7", "valid batch stored in full (201)", r.status_code == 201 and len(stored) == 6 and r.json()["accepted"] is True,
          f"{r.status_code}, {len(stored)} stored")
    listing = user.get(f"/accounts/{A}/transactions", params={"page_size": 200}).json()
    check("AC7", "batch appears on the transactions list", listing["total"] == 6, f"total {listing['total']}")
    oct_detail = user.get(f"/accounts/{A}/summary/months/2026-10").json()
    check("AC7", "batch appears in dashboard actuals", oct_detail["actual"] == "267.30",
          f"Oct actual {oct_detail['actual']}")

    def total() -> int:
        return user.get(f"/accounts/{A}/transactions").json()["total"]

    # ---- AC8
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": [
        item("2026-10-09", "12.00", "便利店", grocery), item("2026-10-09", "13.00", "便利店B", flights)]})
    body = r.json()
    entry = body["details"]["items"][1]
    check("AC8", "unknown (other account's) category: nothing stored, item 1 rejected",
          r.status_code == 409 and body["code"] == "BATCH_REJECTED" and body["details"]["items"][0]["status"] == "ok"
          and entry["code"] == "CATEGORY_NOT_FOUND" and total() == 6,
          f"{r.status_code} {body['code']} '{body['message']}'; item1 {entry['code']} '{entry['message']}'")
    check("AC8", "CATEGORY_NOT_FOUND carries Chinese message and valid categories",
          CJK.search(entry["message"]) and entry["valid_categories"] == tree["categories"],
          f"{len(entry['valid_categories'])} level-1 entries")
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": [item("2026-10-09", "12.00", "便利店", food)]})
    entry = r.json()["details"]["items"][0]
    check("AC8", "level-1 category rejected with its level-2 list",
          r.status_code == 409 and entry["code"] == "CATEGORY_NOT_LEAF"
          and entry["children"] == [{"id": grocery, "name": "超市"}, {"id": takeout, "name": "外卖"}] and total() == 6,
          f"{entry['code']} '{entry['message']}' children={entry['children']}")
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": [item("2026-10-09", "0", "便利店", grocery)]})
    entry = r.json()["details"]["items"][0]
    check("AC8", "invalid field reported per item (INVALID_FIELD)",
          r.status_code == 409 and entry["code"] == "INVALID_FIELD" and total() == 6, f"{entry['code']} {entry.get('errors')}")

    # ---- AC9
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": [batch[2]]})
    entry = r.json()["details"]["items"][0]
    check("AC9", "resubmitted transaction rejected as SUSPECTED_DUPLICATE with the existing record",
          r.status_code == 409 and entry["code"] == "SUSPECTED_DUPLICATE" and entry["existing"]["id"] == stored[2]["id"]
          and total() == 6, f"{entry['code']} existing.id={entry['existing']['id']} hint='{entry['hint']}'")
    variant = dict(batch[2], counterparty="  永辉超市 ", description="pos  消费".upper())
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": [variant]})
    check("AC9", "normalized text (spaces, case) still matches",
          r.status_code == 409 and r.json()["details"]["items"][0]["code"] == "SUSPECTED_DUPLICATE")
    rerun = agent.post(f"/accounts/{A}/transactions/batch", json={"items": batch})
    codes = {e.get("code") for e in rerun.json()["details"]["items"]}
    check("AC9", "re-running the whole batch without flags writes nothing",
          rerun.status_code == 409 and codes == {"SUSPECTED_DUPLICATE"} and total() == 6, f"codes {codes}, total {total()}")
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": [dict(batch[2], confirm_duplicate=True)]})
    confirmed = r.json()["transactions"][0]
    check("AC9", "same item with confirm_duplicate stored as a second transaction",
          r.status_code == 201 and confirmed["confirmed_duplicate"] is True and total() == 7,
          f"{r.status_code} id={confirmed['id']} confirmed_duplicate={confirmed['confirmed_duplicate']}")
    r = agent.post(f"/accounts/{A}/transactions/batch",
                   json={"items": [item("2026-10-09", "15.00", "全家", grocery, confirm_duplicate=True)]})
    flag_ignored = r.json()["transactions"][0]
    check("AC9", "flag on an item without a match is ignored",
          r.status_code == 201 and flag_ignored["confirmed_duplicate"] is False and total() == 8)

    # ---- AC10
    pair = [item("2026-10-09", "22.00", "瑞幸咖啡", takeout), item("2026-10-09", "22.00", "瑞幸咖啡", takeout)]
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": pair})
    entries = r.json()["details"]["items"]
    check("AC10", "two identical items in one batch rejected as in-batch duplicates",
          r.status_code == 409 and entries[0]["status"] == "ok" and entries[1]["code"] == "DUPLICATE_IN_BATCH"
          and entries[1]["duplicate_of_index"] == 0 and total() == 8,
          f"item1 {entries[1]['code']} '{entries[1]['message']}'")
    pair[1]["confirm_duplicate"] = True
    r = agent.post(f"/accounts/{A}/transactions/batch", json={"items": pair})
    check("AC10", "with the flag on the second, both are stored", r.status_code == 201 and total() == 10)

    # ---- AC11
    def actual(month: str, cat_id: int) -> str:
        d = user.get(f"/accounts/{A}/summary/months/{month}").json()
        for l1 in d["categories"]:
            for l2 in l1["children"]:
                if l2["category_id"] == cat_id:
                    return l2["actual"]
        raise KeyError(cat_id)

    before = actual("2026-10", grocery)
    r = agent.post(f"/accounts/{A}/transactions/batch",
                   json={"items": [item("2026-10-09", "-50.00", "永辉超市", grocery, desc="退货")]})
    after = actual("2026-10", grocery)
    check("AC11", "refund reduces its category's month actual",
          r.status_code == 201 and Decimal(after) == Decimal(before) - 50, f"超市 Oct actual {before} -> {after}")

    # ---- AC13 summaries
    monthly = user.get(f"/accounts/{A}/summary/monthly", params={"from": "2026-07", "to": "2026-10"}).json()
    by_month = {m["month"]: (m["budget"], m["actual"]) for m in monthly["months"]}
    check("AC13", "monthly summary: total budget and total actual per month",
          by_month == {"2026-07": (None, "0.00"), "2026-08": ("1500.00", "0.00"),
                       "2026-09": ("1500.00", "388.50"), "2026-10": ("1200.00", "362.70")},
          by_month)
    detail = user.get(f"/accounts/{A}/summary/months/2026-10").json()
    rows = {l1["name"]: (l1["budget"], l1["actual"], {c["name"]: (c["budget"], c["actual"]) for c in l1["children"]})
            for l1 in detail["categories"]}
    check("AC13", "selected month: level-1 rows with nested level-2 rows", set(rows) == {"餐饮", "交通", "购物"}, rows)
    check("AC13", "unbudgeted categories show no budget (null) with actuals",
          rows["购物"][0] is None and rows["购物"][2]["日用"] == (None, "129.90") and rows["餐饮"][2]["外卖"][0] is None,
          {"购物": rows["购物"], "外卖": rows["餐饮"][2]["外卖"]})
    level2_sum = sum(Decimal(c[1]) for r_ in rows.values() for c in r_[2].values())
    check("AC13", "month actual includes every category; budget only budgeted ones",
          Decimal(detail["actual"]) == level2_sum and detail["budget"] == "1200.00",
          f"actual {detail['actual']} (sum of level-2 {level2_sum}), budget {detail['budget']}")
    other = user.get(f"/accounts/{B}/summary/months/2026-10").json()
    check("AC13", "switching account changes all figures",
          other["currency"] == "USD" and other["actual"] == "0.00" and [c["name"] for c in other["categories"]] == ["旅行"],
          f"B: {other['currency']} actual {other['actual']}")

    # ---- AC14 edit and delete
    tx = stored[5]  # 名创优品 129.90 in 日用
    r = user.patch(f"/transactions/{tx['id']}", json={"category_id": grocery, "note": "e2e 改分类"})
    check("AC14", "change category (same account level-2) and note",
          r.status_code == 200 and r.json()["category_id"] == grocery and r.json()["note"] == "e2e 改分类",
          f"{r.status_code} {r.json().get('category_name')} / {r.json().get('note')}")
    moved = {l1["name"]: l1["actual"] for l1 in user.get(f"/accounts/{A}/summary/months/2026-10").json()["categories"]}
    check("AC14", "dashboard figures follow the move", moved["购物"] == "0.00", moved)
    for bad_target, expected in ((flights, "CATEGORY_NOT_FOUND"), (food, "CATEGORY_NOT_LEAF")):
        r = user.patch(f"/transactions/{tx['id']}", json={"category_id": bad_target})
        check("AC14", f"move to invalid category refused ({expected})",
              r.status_code == 422 and code_of(r) == expected, f"{r.status_code} {code_of(r)}")
    r = user.patch(f"/transactions/{tx['id']}", json={"amount": "1.00"})
    check("AC14", "amount is not editable", r.status_code == 422, f"{r.status_code} {code_of(r)}")
    r = user.delete(f"/transactions/{stored[4]['id']}")  # 地铁 6.00
    metro_after = actual("2026-10", metro)
    check("AC14", "delete a transaction; actuals follow", r.status_code == 204 and metro_after == "0.00" and total() == 10,
          f"{r.status_code}, 地铁 actual {metro_after}, total {total()}")

    # ---- AC15 category delete rules
    r = user.delete(f"/categories/{grocery}")
    check("AC15", "category with transactions cannot be deleted",
          r.status_code == 409 and code_of(r) == "CATEGORY_IN_USE", f"{r.status_code} {code_of(r)} {r.json()['message']}")
    r = user.delete(f"/categories/{food}")
    check("AC15", "level-1 with children cannot be deleted", r.status_code == 409 and code_of(r) == "CATEGORY_HAS_CHILDREN",
          f"{r.status_code} {code_of(r)}")
    temp = cat(A, "临时", transport)
    put_budget("2026-10", {temp: "80"})
    had_budget = budgets("2026-10", user).get(temp)
    r = user.delete(f"/categories/{temp}")
    check("AC15", "unused category with budgets can be deleted (budgets go with it)",
          had_budget == "80.00" and r.status_code == 204 and temp not in budgets("2026-10", user),
          f"budget before {had_budget}, delete {r.status_code}")
    r = user.delete(f"/categories/{daily}")  # its only transaction was moved away
    check("AC15", "category whose transactions were moved away can be deleted", r.status_code == 204, r.status_code)

    # ---- AC16 MCP through nginx
    for path in ("/mcp", "/mcp/"):
        url = base + path
        raw = httpx.post(url, json={}, headers={"Accept": "application/json, text/event-stream"}, timeout=30)
        check("AC16", f"{path}: no token -> 401, no redirect", raw.status_code == 401 and code_of(raw) == "INVALID_TOKEN",
              f"{raw.status_code} {code_of(raw)}")
        tools = mcp_tools(url, token)
        names = sorted(t.name for t in tools.tools)
        check("AC16", f"{path}: exactly three tools", names == ["get_budgets", "list_categories", "submit_transactions"], names)
        res = mcp_call(url, token, "list_categories", {"account_id": A})
        check("AC16", f"{path}: list_categories == REST",
              res.is_error is False and res.structured_content == agent.get(f"/accounts/{A}/categories").json())
        res = mcp_call(url, token, "get_budgets", {"account_id": A, "month": "2026-09"})
        check("AC16", f"{path}: get_budgets == REST",
              res.is_error is False
              and res.structured_content == agent.get(f"/accounts/{A}/budgets", params={"month": "2026-09"}).json())
    url = base + "/mcp"
    rejected_items = [batch[0], item("2026-10-09", "9.00", "新店", food), item("2026-10-09", "9.00", "新店2", 999999)]
    rest = agent.post(f"/accounts/{A}/transactions/batch", json={"items": rejected_items})
    res = mcp_call(url, token, "submit_transactions", {"account_id": A, "items": rejected_items})
    codes = [e.get("code") for e in res.structured_content["details"]["items"]]
    check("AC16", "submit_transactions rejection == REST 409 body (+accepted:false), not a tool error",
          rest.status_code == 409 and res.is_error is False and res.structured_content == {"accepted": False, **rest.json()},
          codes)
    n = total()
    res = mcp_call(url, token, "submit_transactions", {"account_id": A, "items": [
        item("2026-10-10", "18.00", "MCP 便利店", grocery, note="via MCP")]})
    check("AC16", "submit_transactions accepted via MCP and visible to REST",
          res.is_error is False and res.structured_content["accepted"] is True and total() == n + 1,
          f"total {n} -> {total()}")
    res = mcp_call(url, token, "list_categories", {"account_id": 999})
    rest = agent.get("/accounts/999/categories")
    check("AC16", "error result carries the REST envelope (ACCOUNT_NOT_FOUND)",
          res.is_error is True and res.structured_content == rest.json(), res.structured_content)

    # ---- AC5 revoke (last, since MCP needs the token above)
    r = user.delete(f"/tokens/{tok['id']}")
    after_revoke = agent.get(f"/accounts/{A}/categories")
    mcp_revoked = httpx.post(f"{base}/mcp", json={}, headers={"Authorization": f"Bearer {token}"}, timeout=30)
    check("AC5", "revoked token stops working immediately (REST and MCP)",
          r.status_code == 204 and after_revoke.status_code == 401 and code_of(after_revoke) == "INVALID_TOKEN"
          and mcp_revoked.status_code == 401,
          f"revoke {r.status_code}; REST {after_revoke.status_code} {code_of(after_revoke)}; MCP {mcp_revoked.status_code}")

    # ---- UI over the LAN
    b = browser(base, "dashboard", username, password, str(SCREENSHOT))
    check("AC13", "dashboard renders in a headless browser over the LAN",
          b.get("ok") and b.get("heading") and "日常账户" in b.get("text", ""),
          {"url": b.get("url"), "browser": b.get("browser"), "heading": b.get("heading"),
           "errors": b.get("errors"), "error": b.get("error")})
    check("AC14", "transactions page loads via SPA deep link",
          b.get("deepLinkStatus") == 200 and "MCP 便利店" in b.get("transactionsText", ""),
          f"status {b.get('deepLinkStatus')}")

    STATE.write_text(json.dumps({
        "username": username, "password": password, "account": A,
        "total": total(), "oct_actual": user.get(f"/accounts/{A}/summary/months/2026-10").json()["actual"],
    }), encoding="utf-8")


def verify(base: str) -> None:
    state = json.loads(STATE.read_text(encoding="utf-8"))
    api = f"{base}/api/v1"
    user = httpx.Client(base_url=api, timeout=30)
    login = user.post("/auth/login", json={"username": state["username"], "password": state["password"]})
    A = state["account"]
    total = user.get(f"/accounts/{A}/transactions").json()["total"]
    actual = user.get(f"/accounts/{A}/summary/months/2026-10").json()["actual"]
    check("restart", "data kept (login, transaction count, month actual)",
          login.status_code == 200 and total == state["total"] and actual == state["oct_actual"],
          f"login {login.status_code}, total {total} (expected {state['total']}), Oct actual {actual}")


def main() -> int:
    mode, base = sys.argv[1], sys.argv[2].rstrip("/")
    try:
        {"walk": walk, "verify": verify}[mode](base)
    except Exception as exc:  # report and fail rather than hide later checks
        import traceback

        traceback.print_exc()
        check("script", "walk aborted", False, repr(exc))
    failed = [r for r in results if not r["ok"]]
    out = HERE / f"e2e_{mode}_results.json"
    out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
