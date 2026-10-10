# ExpenseGauge agent integration guide

For whoever sets up an AI agent (for example Hermes Agent) to record bank transactions in
ExpenseGauge, and for the agent itself. Everything here is taken from the code in
`backend/app/` (`mcp/server.py`, `services/transactions.py`, `schemas/`).

## What the agent does

ExpenseGauge is the source of truth for accounts, categories, budgets and stored
transactions. The agent is the bookkeeper in front of it:

1. **Fetch** the bank's transactions (outside this system; the bank gives no transaction ID).
2. **Filter** them. Only expenses and refunds are stored. Drop income, interest, transfers
   between the user's own accounts and credit-card repayments.
3. **Read the categories** of the target account (`list_categories`). Classify every
   remaining transaction into one **level-2** category (a `children` entry). Level-1
   categories only group.
4. **Ask the user** about anything uncertain (category, whether it is a real expense),
   and only then submit.
5. **Submit** the confirmed batch (`submit_transactions`). Expense = positive amount,
   refund = negative amount in the original expense's category.
6. **Read the feedback.** If the batch is rejected nothing was stored; fix or confirm the
   rejected items with the user and submit the batch again.
7. Optionally read the month's budgets (`get_budgets`) to tell the user how a category
   stands against its budget. The agent cannot read stored transactions or actual
   spending; the user sees those on the Dashboard.

The agent can never change or delete an existing record, edit budgets or categories, or
read user information. Corrections are made by the user in the web UI (Transactions page).

## Connecting

The user does this once, in the web UI under **设置 → AI 助手**:

1. Create an access token ("创建令牌"). It starts with `eg_` and is shown **once**; copy
   it immediately. It can be revoked there at any time and stops working at once.
2. Note the **account ID** of every account the agent should write to (shown on the same
   page). Agents address accounts by ID; there is no tool that lists accounts. A newly
   added account's ID must be given to the agent.
3. Note the **MCP address**: `http://<host>:<WEB_PORT>/mcp`, for example
   `http://192.168.2.144:8080/mcp`. `/mcp/` works too.

### Hermes Agent

Add an HTTP server entry to `~/.hermes/config.yaml`:

```yaml
mcp_servers:
  expensegauge:
    url: "http://192.168.2.144:8080/mcp"
    headers:
      Authorization: "Bearer eg_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
    timeout: 120          # tool call timeout, seconds (optional)
    connect_timeout: 60   # initial connection and initialize handshake (optional)
```

- An entry is either stdio (`command`/`args`/`env`) or HTTP (`url`/`headers`); this one
  is HTTP (MCP Streamable HTTP). No OAuth: a static Bearer token in `headers`.
- `headers` values support `${VAR}` placeholders resolved from the environment
  (including `~/.hermes/.env`), so the token can live there instead, e.g.
  `Authorization: "Bearer ${EXPENSEGAUGE_TOKEN}"`.
- Hermes registers the tools as `mcp_expensegauge_list_categories`,
  `mcp_expensegauge_get_budgets` and `mcp_expensegauge_submit_transactions`.
- After editing the file, restart Hermes or run `/reload-mcp` in a session.
- Optional keys: `enabled: false` to switch the server off, and `tools.include` /
  `tools.exclude` to filter tools (all three are needed for the workflow above).

These keys were re-checked on 2026-10-10 against
<https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp> (section "HTTP
servers", "Basic configuration reference", "Runtime ${ENV_VAR} substitution" and "How
Hermes registers MCP tools").

Also put the account ID(s) into the agent's instructions or memory, e.g. "Record
transactions of my bank card in ExpenseGauge account 1".

### Other MCP clients

Any MCP client with Streamable HTTP works: URL `http://<host>:<port>/mcp`, header
`Authorization: Bearer eg_...`. The server is stateless and answers in JSON (no session
ID needed). A missing, unknown or revoked token gets HTTP 401 with
`{"code": "INVALID_TOKEN", ...}`.

## Conventions

- Money is a decimal **string** with up to 2 decimal places: `"35.50"`, `"-12.00"`.
  Numbers are accepted on input; outputs are always strings.
- Dates are `YYYY-MM-DD`; months are `YYYY-MM`. A transaction belongs to the month of
  its date.
- The account's currency is fixed (`currency` in `get_budgets`); there is no conversion.
  Submit amounts in that currency.
- Every error and every rejected item carries an English `code` (stable, for the agent to
  branch on) and a Simplified Chinese `message` (to relay to the user as is).

## Tools

### `list_categories(account_id: int)`

The account's full two-level category tree.

```json
{
  "account_id": 1,
  "categories": [
    { "id": 10, "name": "餐饮", "children": [
        { "id": 11, "name": "超市" },
        { "id": 12, "name": "外卖" } ] },
    { "id": 20, "name": "交通", "children": [ { "id": 21, "name": "地铁" } ] }
  ]
}
```

Use only `children[].id` as `category_id`. A level-1 category with no children cannot be
used yet.

### `get_budgets(account_id: int, month: str | None = None)`

The budget in force for each level-2 category in `month` (`YYYY-MM`, default: the current
month).

```json
{
  "account_id": 1,
  "currency": "CNY",
  "month": "2026-10",
  "budgets": [
    { "category_id": 11, "category_name": "超市", "parent_id": 10, "parent_name": "餐饮",
      "amount": "1200.00", "effective_from": "2026-01" },
    { "category_id": 21, "category_name": "地铁", "parent_id": 20, "parent_name": "交通",
      "amount": null, "effective_from": null }
  ]
}
```

`amount: null` means **no budget** that month (never set, or cleared). `"0.00"` is a real
budget of zero. A level-1 budget is the sum of its children and is not returned.

### `submit_transactions(account_id: int, items: list[item])`

Submits a batch of 1 to 500 items. **All or nothing.** Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | yes | |
| `amount` | decimal | yes | expense > 0, refund < 0, never 0; at most 2 decimals |
| `counterparty` | string, 1-200 | yes | as on the bank statement |
| `description` | string, 0-1000 | no (default `""`) | as on the bank statement |
| `category_id` | int | yes | a level-2 category of this account |
| `note` | string, 0-1000 | no | free text, e.g. what the user said |
| `confirm_duplicate` | bool | no (default `false`) | **single-use**, see below |

No other fields are accepted (an unknown field rejects that item as `INVALID_FIELD`).

Accepted (everything stored):

```json
{ "accepted": true, "transactions": [
  { "id": 101, "account_id": 1, "category_id": 11, "category_name": "超市",
    "parent_category_id": 10, "parent_category_name": "餐饮",
    "date": "2026-10-03", "amount": "86.40", "counterparty": "永辉超市",
    "description": "POS 消费", "note": null, "confirmed_duplicate": false,
    "created_at": "2026-10-10T12:00:00Z" } ] }
```

Rejected (**nothing stored**, one entry per item, in item order):

```json
{ "accepted": false,
  "code": "BATCH_REJECTED",
  "message": "本批共 3 条，其中 1 条被拒绝，未写入任何数据",
  "details": { "items": [
    { "index": 0, "status": "ok" },
    { "index": 1, "status": "rejected", "code": "SUSPECTED_DUPLICATE",
      "message": "疑似重复：系统中已有一条 2026-10-03 永辉超市 86.40 的流水",
      "existing": { "id": 101, "date": "2026-10-03", "amount": "86.40", "...": "..." },
      "hint": "与用户确认后，带 confirm_duplicate=true 重新提交该条" },
    { "index": 2, "status": "ok" } ] } }
```

`"status": "ok"` on a rejected batch means "this item would have been accepted"; it was
**not** stored either.

## Reason codes and what to do

### Per item, inside `BATCH_REJECTED`

| Code | Extra fields | What the agent should do |
|---|---|---|
| `SUSPECTED_DUPLICATE` | `existing` (the stored record), `hint` | An identical transaction is already stored. Show the user both (date, amount, counterparty, description). If it is the same transaction, **drop the item**. If the user says it is a genuine second transaction (e.g. two identical coffees on one day), set `confirm_duplicate: true` on that item only and resubmit. |
| `DUPLICATE_IN_BATCH` | `duplicate_of_index`, `hint` | The item is identical to an earlier item of the same batch. Ask the user: if it is the same transaction listed twice, drop one; if both are real, set `confirm_duplicate: true` on the later one(s) and resubmit. |
| `CATEGORY_NOT_FOUND` | `valid_categories` (full tree, same shape as `list_categories`) | The `category_id` does not exist or belongs to another account. Re-classify with a level-2 id from `valid_categories` (ask the user if unsure). Your cached category list is probably stale. |
| `CATEGORY_NOT_LEAF` | `parent` `{id, name}`, `children` `[{id, name}]` | A level-1 category was used. Pick one of `children` (ask the user if unsure). If `children` is empty, the user must first add a level-2 category in the web UI. |
| `INVALID_FIELD` | `errors` `[{field, reason}]` | A field is missing, malformed or not allowed (e.g. amount 0, more than 2 decimals, bad date, empty counterparty, unknown field). Fix the item from the source data; do not invent values. |

Duplicate detection: two transactions are "the same" when account, date, amount (to the
cent), counterparty and description match after normalization (Unicode NFKC, trimmed,
whitespace collapsed, case-insensitive). The note and category do not count.

### For the whole request

| Code | HTTP | Meaning / action |
|---|---|---|
| `INVALID_TOKEN` | 401 | Token missing, unknown or revoked. Stop and ask the user for a new token. |
| `TOKEN_SCOPE_FORBIDDEN` | 403 | REST only: an agent token was used on an endpoint other than the three agent operations. Do not retry. |
| `ACCOUNT_NOT_FOUND` | 404 | Wrong `account_id`. Ask the user for the correct ID (settings page). |
| `INVALID_BATCH_SIZE` | 422 | `items` empty or more than 500. Split the batch. |
| `INVALID_MONTH` | 422 | `month` is not `YYYY-MM`. |
| `VALIDATION_ERROR` | 422 | REST only: the request body itself is malformed (`details.errors`). |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | REST only: send `Content-Type: application/json`. |

Over MCP, these come back as a tool result with `isError: true` whose content is the same
envelope `{"code", "message", "details"}`. A rejected batch is **not** an error result: it is
a normal result with `accepted: false`, so read `details.items`.

## The rules that matter

1. **Batches are all-or-nothing.** If any item is rejected, nothing from the batch is
   stored. Resolve every rejected item, then resubmit the **whole** batch (all items, the
   `ok` ones included). Never assume the `ok` items were saved.
2. **`confirm_duplicate` is single-use.** Set it only after the user explicitly confirmed
   that a reported duplicate is a real, separate transaction, only on that item, and only
   for the one resubmission that follows. Never set it pre-emptively, never set it on a
   whole batch, and never keep it in a batch you retry: an item with the flag and a
   matching record is stored **again** every time it is submitted. On an item with no
   matching record the flag is ignored.
3. **Re-running is safe without flags.** Resubmitting an already stored batch without
   flags stores nothing and returns `SUSPECTED_DUPLICATE` for each item. There is no silent
   "already present, skip": drop those items and submit the rest.
4. **No corrections through the agent.** A wrongly stored transaction is fixed (category,
   note) or deleted by the user on the Transactions page.
5. **Refunds** are negative amounts in the category of the original expense.

## REST equivalents

The MCP tools call the same service functions as these REST endpoints and return the same
payloads. Use them with the same `Authorization: Bearer eg_...` header and
`Content-Type: application/json`. Base URL: `http://<host>:<WEB_PORT>/api/v1`.

| MCP tool | REST |
|---|---|
| `list_categories(account_id)` | `GET /accounts/{account_id}/categories` |
| `get_budgets(account_id, month)` | `GET /accounts/{account_id}/budgets?month=YYYY-MM` |
| `submit_transactions(account_id, items)` | `POST /accounts/{account_id}/transactions/batch` with body `{"items": [...]}` |

Differences on REST: success is `201` with `{"accepted": true, "transactions": [...]}`;
a rejected batch is HTTP `409` with the envelope
`{"code": "BATCH_REJECTED", "message", "details": {"items": [...]}}` (no `accepted` key);
other errors use the HTTP statuses in the table above. Every other endpoint answers an
agent token with `403 TOKEN_SCOPE_FORBIDDEN`.

The full contract is at `/api/docs` (Swagger UI) and `/api/openapi.json`.
