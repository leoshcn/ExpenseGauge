# ExpenseGauge MVP - end-to-end results (step 12)

Date: 2026-10-10. Target: the composed stack on the Debian 13 LXC at `192.168.2.144`
(`/opt/expense-gauge`, Docker 29.9, Compose v5.6, 2 CPU, 2 GB RAM, no swap), reached from
the Windows workstation over the LAN at `http://192.168.2.144:8080`. Source: `feat/mvp`
at `f74049b` plus the uncommitted deployment files of this task.

How it was run:

- `docker compose down -v --rmi local`, builder cache pruned, then
  `docker compose up -d --build` (fresh project images, empty volume), then the walk.
- Walk: `cd backend && uv run python ../.trellis/tasks/10-10-mvp-integration/e2e_walk.py walk http://192.168.2.144:8080`
  (httpx for REST, the official `mcp` SDK 2.3.0 from `backend/uv.lock` for MCP, and
  `e2e_browser.mjs` with the frontend's Playwright driving headless Microsoft Edge
  155.0.4283.45). Raw results: `e2e_walk_results.json`.
- The walk ran twice. The first run, on the same build, passed 71 of 72; the one failure
  was a float rounding bug in the script's own AC13 check (`362.70` against
  `362.70000000000005`), fixed by comparing `Decimal`s. The second run, on a fresh
  volume, is the one recorded below: **72 of 72 passed**.

## Summary per acceptance criterion

| AC | Result | Evidence (each check is in the table at the end) |
|---|---|---|
| AC1 | PASS | `docker compose ps`: `api` healthy (8000/tcp, not published), `db` healthy (5432/tcp, not published), `web` healthy `0.0.0.0:8080->80/tcp`. `ss -tlnp` on the server: only `:8080` (docker-proxy) and `:22` (sshd) listen on non-loopback addresses. The UI loads over the LAN. |
| AC2 | PASS | With no user the browser lands on `/setup`; `POST /setup` 201 with an HttpOnly, SameSite=lax cookie (not Secure: plain HTTP); a second `POST /setup` gets 409 `USER_ALREADY_EXISTS`. |
| AC3 | PASS | After setup the browser is redirected from `/dashboard` to `/onboarding`; account and two-level categories created; a third level is refused (`INVALID_PARENT`). |
| AC4 | PASS | 11 non-setup endpoints answer 401 without auth; `/api/v1/health`, `/api/docs`, `/api/openapi.json` are public; the session has full access; an agent token gets 200 on categories, budgets and batch and `403 TOKEN_SCOPE_FORBIDDEN` on 16 other operations; a form-encoded POST gets 415. |
| AC5 | PASS | The token (`eg_...`, 46 characters) is only in the create response; the list has no `token` field; after revoking, REST returns 401 `INVALID_TOKEN` and MCP 401 immediately. |
| AC6 | PASS | Category tree exact; budgets per level-2 category for a month, including `null` (no budget) and `"0.00"`. |
| AC7 | PASS | A 6-item batch gets 201, all items are on the transactions list, October actual 267.30. |
| AC8 | PASS | A category of another account: 409 `BATCH_REJECTED`, item 1 `CATEGORY_NOT_FOUND` with a Chinese message and `valid_categories`; a level-1 category: `CATEGORY_NOT_LEAF` with its children; amount 0: `INVALID_FIELD`; nothing stored each time. |
| AC9 | PASS | Resubmission: `SUSPECTED_DUPLICATE` with `existing.id`; whitespace and case variants match too; re-running the full batch without flags writes nothing; with `confirm_duplicate` the item is stored as a second row (`confirmed_duplicate: true`); the flag without a match is ignored. |
| AC10 | PASS | An identical pair: item 1 `DUPLICATE_IN_BATCH`, `duplicate_of_index: 0`; with the flag on the second item both are stored. |
| AC11 | PASS | A refund of -50.00 takes 超市's October actual from 187.80 to 137.80. |
| AC12 | PASS | Set from 2026-08; changed from 2026-10 (08 and 09 keep 1000, 10 and 12 show 1200); cleared from 2026-10 (09 keeps 500, 10 and 12 `null`); a level-1 budget is refused. |
| AC13 | PASS | Monthly series 07-10 = (none, 0), (1500, 0), (1500, 388.50), (1200, 362.70); month detail has level-1 rows with level-2 children; unbudgeted categories show `null` with actuals; month actual = sum of all level-2 actuals, budget sums budgeted ones only; account B (USD) shows its own figures. Dashboard rendered in Edge: `e2e-dashboard.png`. |
| AC14 | PASS | Category and note changed (same-account level-2 only; another account's category gets `CATEGORY_NOT_FOUND`, level-1 gets `CATEGORY_NOT_LEAF`, `amount` gets 422); summaries follow; delete 204 and the actual drops; the `/transactions` deep link is served by the SPA fallback. |
| AC15 | PASS | In use: 409 `CATEGORY_IN_USE`; level-1 with children: 409 `CATEGORY_HAS_CHILDREN`; a level-2 category with only a budget: 204 and its budget is gone; a level-2 whose transactions were moved away: 204. |
| AC16 | PASS | Through nginx at `/mcp` **and** `/mcp/`: no token gets 401 (no redirect); `list_tools` is exactly the three tools; `list_categories` and `get_budgets` equal the REST payloads; a rejected `submit_transactions` equals the REST 409 body plus `accepted: false` and is not a tool error; an accepted one is visible through REST; `ACCOUNT_NOT_FOUND` comes back as an error result carrying the REST envelope. |
| AC17 | PASS (local) | Backend: `ruff check` clean, `ruff format --check` clean, `pytest` 71 passed. Frontend: `gen:api` (no diff), `typecheck`, `lint`, `test` 95 passed. The OpenAPI document is served at `/api/openapi.json` on the deployment. |
| AC18 | PASS | `docs/agent-guide.md` written; `.trellis/spec/backend/deployment.md` added; backend and frontend directory-structure specs updated. |

## Restart and persistence

| Test | Result | Evidence |
|---|---|---|
| `docker compose restart` | PASS | All three healthy again; `e2e_walk.py verify`: login 200, 11 transactions (expected 11), October actual 374.70 (`e2e_verify_results.json`) |
| `docker compose down`, then `up -d --wait` | PASS | Volume `expense-gauge_db-data` survived `down`; same verify result |

## Other deployment checks

- nginx: hashed assets get `Cache-Control: public, max-age=31536000, immutable` and gzip;
  HTML gets `Cache-Control: no-cache`; an unknown `/assets/...` is 404 (no SPA fallback
  there); `/mcp` responses carry `X-Accel-Buffering: no` and are not gzipped.
- uvicorn logs show the LAN client address (`192.168.2.136`), so `X-Forwarded-For`
  reaches the app through `--proxy-headers`.
- The `api` container runs as `uid=10001(app)`; `pytest`, `ruff`, `pgserver` and `httpx`
  are not installed in it; `mcp` is 2.3.0 as in the lock.
- No swap was needed: in the frontend image `npm ci` took about 12 s and the build 9 s on
  the 2 GB container.
- Base image pulls inside BuildKit stalled twice on this host (layer downloads stuck at a
  fixed size); `docker pull` of the same images worked, after which the build used them.
  A network quirk of this host, not of the project files.

## Final state

After these checks the volume was removed (`docker compose down -v`) and the stack was
started again empty, so first-time setup is left to the user.

## Every check of the recorded walk

| AC | Check | Result | Evidence |
|---|---|---|---|
| AC1 | web UI served over the LAN | PASS | GET / -> 200 text/html |
| AC2 | no user: setup status says so | PASS | {"user_exists": false} |
| AC2 | browser routes to user creation | PASS | {"url": "http://192.168.2.144:8080/setup", "browser": "155.0.4283.45", "error": null, "errors": []} |
| AC2 | weak password rejected | PASS | 422 VALIDATION_ERROR |
| AC2 | first user created and signed in | PASS | 201; Set-Cookie flags: HttpOnly; Max-Age=2592000; Path=/; SameSite=lax |
| AC2 | setup refuses a second user | PASS | 409 USER_ALREADY_EXISTS 用户已存在，无法再次创建 |
| AC2 | setup status now true | PASS |  |
| AC4 | login with wrong password | PASS | 401 INVALID_CREDENTIALS |
| AC4 | login sets session; /auth/me works | PASS | login 200, me 200 |
| AC3 | no account yet after setup | PASS |  |
| AC3 | browser is sent to onboarding before the dashboard | PASS | {"url": "http://192.168.2.144:8080/onboarding", "error": null, "errors": []} |
| AC3 | first account created (currency normalized) | PASS | {"id": 1, "name": "日常账户", "currency": "CNY"} |
| AC3 | categories are two levels only | PASS | 422 INVALID_PARENT |
| AC4 | health and API docs are public | PASS | {"/health": 200, "/api/docs": 200, "/api/openapi.json": 200} |
| AC4 | every non-setup endpoint rejects unauthenticated requests | PASS | {"GET /auth/me": 401, "GET /tokens": 401, "GET /accounts": 401, "GET /accounts/1/categories": 401, "GET /accounts/1/budgets": 401, "GET /accounts/1/transactions": 401, "GET /accounts/1/summary/monthly": 401, "GET /accounts/1/summary/months/2026-10": 401, "P... |
| AC4 | state change needs application/json (CSRF guard) | PASS | 415 UNSUPPORTED_MEDIA_TYPE |
| AC5 | token shown at creation | PASS | 201, token prefix eg_, length 46 |
| AC5 | token not retrievable afterwards | PASS | list keys: ['created_at', 'id', 'last_used_at', 'name', 'revoked_at'] |
| AC4 | agent token allowed on the read operations | PASS | {"GET categories": 200, "GET budgets": 200} |
| AC4 | agent token gets 403 everywhere else | PASS | {"GET /auth/me": "403 TOKEN_SCOPE_FORBIDDEN", "GET /tokens": "403 TOKEN_SCOPE_FORBIDDEN", "POST /tokens": "403 TOKEN_SCOPE_FORBIDDEN", "DELETE /tokens/1": "403 TOKEN_SCOPE_FORBIDDEN", "GET /accounts": "403 TOKEN_SCOPE_FORBIDDEN", "POST /accounts": "403 TOKE... |
| AC4 | session cookie grants full access | PASS |  |
| AC6 | list_categories (REST) returns the two-level tree | PASS | {"餐饮": ["超市", "外卖"], "交通": ["地铁"], "购物": ["日用"]} |
| AC12 | set budgets from 2026-08 | PASS | 200 |
| AC6 | get_budgets per level-2 category for a month | PASS | {"2": "1000.00", "3": "500.00", "5": "0.00", "7": null} |
| AC12 | month before the first budget has none | PASS | {"2": null, "3": null, "5": null, "7": null} |
| AC12 | change from 2026-10 applies to 10 and later only | PASS | {"2026-08": "1000.00", "2026-09": "1000.00", "2026-10": "1200.00", "2026-12": "1200.00"} |
| AC12 | clear from 2026-10 shows no budget for 10 and later, earlier kept | PASS | {"2026-08": "500.00", "2026-09": "500.00", "2026-10": null, "2026-12": null} |
| AC12 | level-1 budget cannot be entered | PASS | 422 CATEGORY_NOT_LEAF |
| AC7 | valid batch stored in full (201) | PASS | 201, 6 stored |
| AC7 | batch appears on the transactions list | PASS | total 6 |
| AC7 | batch appears in dashboard actuals | PASS | Oct actual 267.30 |
| AC8 | unknown (other account's) category: nothing stored, item 1 rejected | PASS | 409 BATCH_REJECTED '本批共 2 条，其中 1 条被拒绝，未写入任何数据'; item1 CATEGORY_NOT_FOUND '分类 9 不存在或不属于该账户，请从 valid_categories 的二级分类中选择' |
| AC8 | CATEGORY_NOT_FOUND carries Chinese message and valid categories | PASS | 3 level-1 entries |
| AC8 | level-1 category rejected with its level-2 list | PASS | CATEGORY_NOT_LEAF '“餐饮”是一级分类，流水只能归入其下的二级分类' children=[{'id': 2, 'name': '超市'}, {'id': 3, 'name': '外卖'}] |
| AC8 | invalid field reported per item (INVALID_FIELD) | PASS | INVALID_FIELD [{'field': 'amount', 'reason': 'Value error, amount must not be 0'}] |
| AC9 | resubmitted transaction rejected as SUSPECTED_DUPLICATE with the existing record | PASS | SUSPECTED_DUPLICATE existing.id=3 hint='与用户确认后，带 confirm_duplicate=true 重新提交该条' |
| AC9 | normalized text (spaces, case) still matches | PASS |  |
| AC9 | re-running the whole batch without flags writes nothing | PASS | codes {'SUSPECTED_DUPLICATE'}, total 6 |
| AC9 | same item with confirm_duplicate stored as a second transaction | PASS | 201 id=7 confirmed_duplicate=True |
| AC9 | flag on an item without a match is ignored | PASS |  |
| AC10 | two identical items in one batch rejected as in-batch duplicates | PASS | item1 DUPLICATE_IN_BATCH '与本批第 0 条（index=0）内容相同' |
| AC10 | with the flag on the second, both are stored | PASS |  |
| AC11 | refund reduces its category's month actual | PASS | 超市 Oct actual 187.80 -> 137.80 |
| AC13 | monthly summary: total budget and total actual per month | PASS | {"2026-07": [null, "0.00"], "2026-08": ["1500.00", "0.00"], "2026-09": ["1500.00", "388.50"], "2026-10": ["1200.00", "362.70"]} |
| AC13 | selected month: level-1 rows with nested level-2 rows | PASS | {"餐饮": ["1200.00", "226.80", {"超市": ["1200.00", "137.80"], "外卖": [null, "89.00"]}], "交通": ["0.00", "6.00", {"地铁": ["0.00", "6.00"]}], "购物": [null, "129.90", {"日用": [null, "129.90"]}]} |
| AC13 | unbudgeted categories show no budget (null) with actuals | PASS | {"购物": [null, "129.90", {"日用": [null, "129.90"]}], "外卖": [null, "89.00"]} |
| AC13 | month actual includes every category; budget only budgeted ones | PASS | actual 362.70 (sum of level-2 362.70), budget 1200.00 |
| AC13 | switching account changes all figures | PASS | B: USD actual 0.00 |
| AC14 | change category (same account level-2) and note | PASS | 200 超市 / e2e 改分类 |
| AC14 | dashboard figures follow the move | PASS | {"餐饮": "356.70", "交通": "6.00", "购物": "0.00"} |
| AC14 | move to invalid category refused (CATEGORY_NOT_FOUND) | PASS | 422 CATEGORY_NOT_FOUND |
| AC14 | move to invalid category refused (CATEGORY_NOT_LEAF) | PASS | 422 CATEGORY_NOT_LEAF |
| AC14 | amount is not editable | PASS | 422 VALIDATION_ERROR |
| AC14 | delete a transaction; actuals follow | PASS | 204, 地铁 actual 0.00, total 10 |
| AC15 | category with transactions cannot be deleted | PASS | 409 CATEGORY_IN_USE 该分类下已有流水，无法删除 |
| AC15 | level-1 with children cannot be deleted | PASS | 409 CATEGORY_HAS_CHILDREN |
| AC15 | unused category with budgets can be deleted (budgets go with it) | PASS | budget before 80.00, delete 204 |
| AC15 | category whose transactions were moved away can be deleted | PASS | 204 |
| AC16 | /mcp: no token -> 401, no redirect | PASS | 401 INVALID_TOKEN |
| AC16 | /mcp: exactly three tools | PASS | ["get_budgets", "list_categories", "submit_transactions"] |
| AC16 | /mcp: list_categories == REST | PASS |  |
| AC16 | /mcp: get_budgets == REST | PASS |  |
| AC16 | /mcp/: no token -> 401, no redirect | PASS | 401 INVALID_TOKEN |
| AC16 | /mcp/: exactly three tools | PASS | ["get_budgets", "list_categories", "submit_transactions"] |
| AC16 | /mcp/: list_categories == REST | PASS |  |
| AC16 | /mcp/: get_budgets == REST | PASS |  |
| AC16 | submit_transactions rejection == REST 409 body (+accepted:false), not a tool error | PASS | ["SUSPECTED_DUPLICATE", "CATEGORY_NOT_LEAF", "CATEGORY_NOT_FOUND"] |
| AC16 | submit_transactions accepted via MCP and visible to REST | PASS | total 10 -> 11 |
| AC16 | error result carries the REST envelope (ACCOUNT_NOT_FOUND) | PASS | {"code": "ACCOUNT_NOT_FOUND", "message": "账户不存在", "details": {}} |
| AC5 | revoked token stops working immediately (REST and MCP) | PASS | revoke 204; REST 401 INVALID_TOKEN; MCP 401 |
| AC13 | dashboard renders in a headless browser over the LAN | PASS | {"url": "http://192.168.2.144:8080/dashboard", "browser": "155.0.4283.45", "heading": "概览", "errors": [], "error": null} |
| AC14 | transactions page loads via SPA deep link | PASS | status 200 |
