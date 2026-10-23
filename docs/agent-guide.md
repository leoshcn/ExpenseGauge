# ExpenseGauge agent integration guide

For whoever sets up an AI agent (for example Hermes Agent) to record bank transactions in
ExpenseGauge, and for the agent itself. Everything here is taken from the code in
`backend/app/` (`mcp/server.py`, `services/transactions.py`, `schemas/`).

## The model in three words

- **Payment channel** (付款渠道): where a transaction comes from, for example one bank
  card, one credit card or one payment app's statement. The agent submits each channel's
  transactions with that channel's ID. A channel only records the source and scopes
  duplicate detection; it has nothing to do with budgets.
- **Category** (分类): what the money was spent on. One global two-level tree. Only
  level-2 categories (the `children`) take transactions.
- **Budget account** (预算账户): which budget pool the money counts towards, for example
  "日常" or "固定". Every level-2 category belongs to exactly one budget account, and a
  transaction counts towards the budget account of its category. **For the agent this is
  reference information only**: any level-2 category may be used for a transaction from
  any channel. A rent paid from the everyday card goes into "居住 / 房租" and therefore
  counts towards whatever budget account "房租" belongs to; nothing special is needed.
  A budget account is monthly or annual (`period`, see `get_budgets`); submitting
  transactions works the same for both.

All amounts are in one **base currency** (基础币种), set by the user (`currency` in
`get_budgets`). There is no currency conversion in ExpenseGauge.

## What the agent does

ExpenseGauge is the source of truth for channels, categories, budgets and stored
transactions. The agent is the bookkeeper in front of it:

1. **Fetch** one channel's transactions (outside this system; the bank gives no
   transaction ID).
2. **Filter** them. Only expenses and refunds are stored. Drop income, interest,
   transfers between the user's own accounts and credit-card repayments.
3. **Convert** foreign-currency spending into the base currency at that day's exchange
   rate before submitting (for example with the amount the card was actually charged in
   the base currency). Keep the original amount in `note` if useful, e.g. `"USD 16.90"`.
4. **Read the channels and categories** (`list_channels`, `list_categories`). Classify
   every remaining transaction into one **level-2** category (a `children` entry), from
   the whole tree. Level-1 categories only group. A level-2 category may carry a
   `description` written by the user (what belongs there and what does not); follow it
   when choosing. Its `budget_account` is shown for reference and never restricts the
   choice.
5. **Ask the user** about anything uncertain (category, whether it is a real expense),
   and only then submit.
6. **Match refunds to their payments.** For each refund, find the payment it reverses:
   in the same batch (`refund_of_index`), or already stored (`find_payments`, then
   `refund_of_id`). If you cannot find it or are unsure, ask the user; if it still cannot
   be determined, submit the refund without either field (it is stored unmatched and the
   user can match it later).
7. **Submit** the confirmed batch of **one channel** (`submit_transactions(channel_id,
   items)`). Expense = positive amount, refund = negative amount.
8. **Read the feedback.** If the batch is rejected nothing was stored; fix or confirm the
   rejected items with the user and submit the batch again.
9. Optionally read the month's budgets (`get_budgets`) to tell the user how a category
   stands against its budget. The agent can find stored transactions (`find_payments` to
   match refunds, `find_transactions` to recategorize) but cannot read actual spending;
   the user sees that on the Dashboard.
10. **Recategorize** stored transactions when the user asks for it or confirms it:
    find them with `find_transactions`, then `recategorize_transactions` with a reason
    for each. The reason is appended to the transaction's note for the user to read.

Apart from a stored transaction's category, the agent can never change or delete an
existing record (a stored match included), edit budgets, categories, channels or budget
accounts, or read user information. Other corrections are made by the user in the web UI
(Transactions page).

### How a matched refund counts

A refund matched to a payment counts in the **payment's** month and category: the
payment's net amount is its amount minus its matched refunds. A payment counts as one
"consumption" (消费笔数) while its net amount is above zero; fully refunded, it no longer
counts. An unmatched refund counts in its own month and in its own `category_id`. One
payment may have several refunds (partial or repeated) as long as they add up to at most
its amount; one refund matches at most one payment.

## Connecting

The user does this once, in the web UI under **设置 → AI 助手**:

1. Create an access token ("创建令牌"). It starts with `eg_` and is shown **once**; copy
   it immediately. It can be revoked there at any time and stops working at once.
2. Note the **MCP address**: `http://<host>:<WEB_PORT>/mcp`, for example
   `http://192.168.2.144:8080/mcp`. `/mcp/` works too.
3. Tell the agent which statement belongs to which **channel**. The channel IDs are
   listed on the same page (and under 设置 → 账本); the agent can also look them up with
   `list_channels`. A channel added later is visible to `list_channels` at once.

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
- Hermes registers the tools as `mcp_expensegauge_list_channels`,
  `mcp_expensegauge_list_categories`, `mcp_expensegauge_get_budgets`,
  `mcp_expensegauge_find_payments`, `mcp_expensegauge_find_transactions`,
  `mcp_expensegauge_submit_transactions` and `mcp_expensegauge_recategorize_transactions`.
- After editing the file, restart Hermes or run `/reload-mcp` in a session.
- Optional keys: `enabled: false` to switch the server off, and `tools.include` /
  `tools.exclude` to filter tools (the workflow above needs all seven; exclude
  `find_transactions` and `recategorize_transactions` to keep the agent from changing
  stored categories).

These keys were re-checked on 2026-10-10 against
<https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp> (section "HTTP
servers", "Basic configuration reference", "Runtime ${ENV_VAR} substitution" and "How
Hermes registers MCP tools").

Also put the mapping into the agent's instructions or memory, e.g. "My China Merchants
debit card is ExpenseGauge channel 1, my credit card is channel 2".

### Other MCP clients

Any MCP client with Streamable HTTP works: URL `http://<host>:<port>/mcp`, header
`Authorization: Bearer eg_...`. The server is stateless and answers in JSON (no session
ID needed). A missing, unknown or revoked token gets HTTP 401 with
`{"code": "INVALID_TOKEN", ...}`.

## Conventions

- Money is a decimal **string** with up to 2 decimal places: `"35.50"`, `"-12.00"`.
  Numbers are accepted on input; outputs are always strings.
- Every amount is in the **base currency** (`currency` in `get_budgets`). Convert
  foreign-currency spending at that day's rate before submitting; ExpenseGauge does not
  convert. If the user changes the base currency, stored amounts are relabelled, not
  converted.
- Dates are `YYYY-MM-DD`; months are `YYYY-MM`. A transaction belongs to the month of
  its date.
- Every error and every rejected item carries an English `code` (stable, for the agent to
  branch on) and a Simplified Chinese `message` (to relay to the user as is).

## Tools

### `list_channels()`

The payment channels, in creation order.

```json
{
  "channels": [
    { "id": 1, "name": "储蓄卡" },
    { "id": 2, "name": "招行信用卡" }
  ]
}
```

Use `id` as `channel_id` in `submit_transactions`. Only the user can add or rename
channels (web UI, 设置 → 账本).

### `list_categories()`

The global two-level category tree.

```json
{
  "budget_account_id": null,
  "categories": [
    { "id": 10, "name": "餐饮", "children": [
        { "id": 11, "name": "超市", "description": "线下商超、便利店；不含外卖",
          "budget_account": { "id": 1, "name": "日常", "period": "month" } },
        { "id": 12, "name": "外卖", "description": null,
          "budget_account": { "id": 1, "name": "日常", "period": "month" } } ] },
    { "id": 20, "name": "居住", "children": [
        { "id": 21, "name": "房租", "description": null,
          "budget_account": { "id": 2, "name": "固定", "period": "month" } } ] },
    { "id": 30, "name": "年度开支", "children": [
        { "id": 31, "name": "保险", "description": null,
          "budget_account": { "id": 3, "name": "年度", "period": "year" } } ] }
  ]
}
```

Use only `children[].id` as `category_id`, from any level-1 category. A level-1 category
with no children cannot be used yet.

The order of `categories` and of each `children` array is the display order the user set
in the web UI (设置 → 分类). It does not express priority: a category listed first is not
a better match. Only the user can change it; the agent cannot.

`description` (level 2 only, up to 500 characters, may contain line breaks) is the user's
own note on what belongs in that category, for example which merchants or which kinds of
spending, and what does not. When it is present, follow it when classifying; when a
transaction still fits more than one category, ask the user. It is `null` when the user
wrote none. Only the user can edit it (web UI, 设置 → 分类); the agent cannot.

`budget_account` is the budget pool the category counts towards. It is for reference
(for example to tell the user "this goes against your 固定 budget") and does **not**
restrict which channel may use the category. The user may move a category to another
budget account at any time; its history moves with it (or, when the move is between a
monthly and an annual budget account, the user sets a new budget). Its `period` is
explained under `get_budgets`.

### `get_budgets(month: str | None = None, budget_account_id: int | None = None)`

The budget in force for each level-2 category in `month` (`YYYY-MM`, default: the current
month). With `budget_account_id` only that budget account's categories are listed;
without it, all of them.

```json
{
  "budget_account_id": null,
  "currency": "CNY",
  "month": "2026-10",
  "budgets": [
    { "category_id": 11, "category_name": "超市", "parent_id": 10, "parent_name": "餐饮",
      "budget_account_id": 1, "budget_account_name": "日常", "period": "month",
      "amount": "1200.00", "effective_from": "2026-01" },
    { "category_id": 21, "category_name": "房租", "parent_id": 20, "parent_name": "居住",
      "budget_account_id": 2, "budget_account_name": "固定", "period": "month",
      "amount": null, "effective_from": null },
    { "category_id": 31, "category_name": "保险", "parent_id": 30, "parent_name": "年度开支",
      "budget_account_id": 3, "budget_account_name": "年度", "period": "year",
      "amount": "12000.00", "effective_from": "2026-01" }
  ]
}
```

`amount: null` means **no budget** that month (never set, or cleared). `"0.00"` is a real
budget of zero. A level-1 budget is the sum of its children and is not returned.
`currency` is the base currency.

`period` is the period of the line's budget account:

- `"month"`: `amount` is the budget for that one month. Compare it with the month's
  spending.
- `"year"`: `amount` is the budget for the **whole calendar year** of `month`, and
  `effective_from` is always January (`YYYY-01`). Compare it with the spending from
  January up to now, never with a single month's, and do not divide it by 12. One large
  payment (an annual insurance premium, a holiday) is expected in such a category.

### `find_payments(date_from: str, date_to: str, channel_id: int | None = None, counterparty: str | None = None, limit: int = 20)`

Stored **payments** (positive amounts; refunds are never returned) dated from `date_from`
to `date_to` (`YYYY-MM-DD`, both inclusive; the range covers at most 366 days, both ends
counted), newest first. Use it only to find the payment a refund reverses.

- `channel_id`: only that channel's payments. A refund usually, but not always, comes
  back on the channel that paid; search without it when nothing is found.
- `counterparty`: matched anywhere in the counterparty, ignoring case.
- `limit`: 1 to 50.

```json
{ "payments": [
  { "id": 87, "channel_id": 1, "channel_name": "储蓄卡", "date": "2026-09-28",
    "amount": "199.00", "counterparty": "京东", "description": "网购",
    "category_id": 41, "category_name": "数码", "refunded": "50.00", "refundable": "149.00" } ] }
```

`refunded` is what is already matched to it; `refundable` (`amount - refunded`) is the most
a new refund of it may be. A payment is never dated after its refund, so `date_to` can be
the refund's date.

### `submit_transactions(channel_id: int, items: list[item])`

Submits a batch of 1 to 500 items, all from **one channel**. **All or nothing.** Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | yes | |
| `amount` | decimal | yes | in the base currency; expense > 0, refund < 0, never 0; at most 2 decimals |
| `counterparty` | string, 1-200 | yes | as on the statement |
| `description` | string, 0-1000 | no (default `""`) | as on the statement |
| `category_id` | int | yes | any level-2 category |
| `note` | string, 0-1000 | no | free text, e.g. what the user said or the original foreign amount. `#tags` in it (`#国庆2026`: up to a space, `#` or punctuation) group transactions across categories in the app; add one when the user names a trip or event |
| `confirm_duplicate` | bool | no (default `false`) | **single-use**, see below |
| `refund_of_id` | int | no | refunds only: `id` of the stored payment it reverses (from `find_payments`) |
| `refund_of_index` | int | no | refunds only: `index` of the payment item in this same batch that it reverses |

No other fields are accepted (an unknown field rejects that item as `INVALID_FIELD`).
`refund_of_id` and `refund_of_index` are mutually exclusive (both on one item:
`INVALID_FIELD`). A matched refund still needs a level-2 `category_id`: it is ignored while
the match exists (the refund counts in its payment's category) and applies again if the
user removes the match; the original expense's category is the natural choice. A refund
without either field is stored **unmatched**, exactly as before.

Each transaction in the result also carries `refund_of` (`{id, date, amount,
counterparty, category_name}` of the matched payment, or `null`) and `refunded` (a
payment's matched refunds, positive; `"0.00"` for a refund). A matched refund's
`category_*` and `budget_account_*` are its payment's.

Accepted (everything stored):

```json
{ "accepted": true, "transactions": [
  { "id": 101, "channel_id": 1, "channel_name": "储蓄卡",
    "category_id": 11, "category_name": "超市",
    "parent_category_id": 10, "parent_category_name": "餐饮",
    "budget_account_id": 1, "budget_account_name": "日常",
    "date": "2026-10-03", "amount": "86.40", "counterparty": "永辉超市",
    "description": "POS 消费", "note": null, "confirmed_duplicate": false,
    "created_at": "2026-10-10T12:00:00Z" } ] }
```

`budget_account_id` / `budget_account_name` follow from the category; they are not stored
on the transaction.

Rejected (**nothing stored**, one entry per item, in item order):

```json
{ "accepted": false,
  "code": "BATCH_REJECTED",
  "message": "本批共 3 条，其中 1 条被拒绝，未写入任何数据",
  "details": { "items": [
    { "index": 0, "status": "ok" },
    { "index": 1, "status": "rejected", "code": "SUSPECTED_DUPLICATE",
      "message": "疑似重复：该渠道已有一条 2026-10-03 永辉超市 86.40 的流水",
      "existing": { "id": 101, "date": "2026-10-03", "amount": "86.40", "...": "..." },
      "hint": "与用户确认后，带 confirm_duplicate=true 重新提交该条" },
    { "index": 2, "status": "ok" } ] } }
```

`"status": "ok"` on a rejected batch means "this item would have been accepted"; it was
**not** stored either.

### `find_transactions(date_from: str, date_to: str, channel_id: int | None = None, category_id: int | None = None, q: str | None = None, kind: str | None = None, limit: int = 20)`

Stored **payments and refunds** dated from `date_from` to `date_to` (same bounds as
`find_payments`: at most 366 days, both ends counted), newest first. Use it to find the
transactions to recategorize.

- `channel_id`: only that channel's transactions.
- `category_id`: a level-2 category, or a level-1 category for all of its children. A
  matched refund is found under its payment's category (the one it counts in).
- `q`: matched anywhere in the counterparty or the description, ignoring case.
- `kind`: `"payment"` or `"refund"`; omitted, both.
- `limit`: 1 to 50.

Returns `{"transactions": [...]}`, each in the same shape as `submit_transactions`
returns (`id`, `category_*`, `parent_category_*`, `note`, `refund_of`, ...). A refund with
a non-null `refund_of` is matched to a payment and cannot be recategorized on its own.

### `recategorize_transactions(items: list[item])`

Changes the category of 1 to 100 stored transactions. **All or nothing.** Call it only
when the user asked for the change or confirmed it. Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `transaction_id` | int | yes | from `find_transactions` |
| `category_id` | int | yes | the new level-2 category |
| `reason` | string, 1-200 | yes | why the category is changed, in words the user will understand; leading and trailing whitespace is trimmed |

Each change appends one line to the transaction's note, after a line break when the
note is not empty; the existing note is kept:

```
[Agent 改分类] 餐饮/买菜 → 交通/打车：实为滴滴打车，不是买菜
```

Nothing else of the transaction changes. A payment's matched refunds follow it to the new
category. The result is `{"accepted": true, "transactions": [...]}` with the changed
transactions; a rejected call is `{"accepted": false, "code": "BATCH_REJECTED", ...}` with
one entry per item, as for `submit_transactions`, and **nothing is changed**.

## Reason codes and what to do

### Per item, inside `BATCH_REJECTED`

| Code | Extra fields | What the agent should do |
|---|---|---|
| `SUSPECTED_DUPLICATE` | `existing` (the stored record), `hint` | An identical transaction of the **same channel** is already stored. Show the user both (date, amount, counterparty, description). If it is the same transaction, **drop the item**. If the user says it is a genuine second transaction (e.g. two identical coffees on one day), set `confirm_duplicate: true` on that item only and resubmit. |
| `DUPLICATE_IN_BATCH` | `duplicate_of_index`, `hint` | The item is identical to an earlier item of the same batch. Ask the user: if it is the same transaction listed twice, drop one; if both are real, set `confirm_duplicate: true` on the later one(s) and resubmit. |
| `CATEGORY_NOT_FOUND` | `valid_categories` (the global tree, same shape as `list_categories`) | The `category_id` does not exist. Re-classify with a level-2 id from `valid_categories` (ask the user if unsure). Your cached category list is probably stale. |
| `CATEGORY_NOT_LEAF` | `parent` `{id, name}`, `children` `[{id, name, description, budget_account}]` | A level-1 category was used. Pick one of `children` (ask the user if unsure). If `children` is empty, the user must first add a level-2 category in the web UI. |
| `INVALID_FIELD` | `errors` `[{field, reason}]` | A field is missing, malformed or not allowed (e.g. amount 0, more than 2 decimals, bad date, empty counterparty, unknown field, both `refund_of_id` and `refund_of_index`). Fix the item from the source data; do not invent values. |
| `INVALID_REFUND_TARGET` | `refund_of_id` or `refund_of_index` | The match is not possible: the item is not a refund, the target does not exist, is a refund or the item itself, is dated after the refund, or (for `refund_of_index`) the referenced item is itself rejected. Check with `find_payments` / the batch; if the right payment cannot be found, ask the user, or drop the field to store the refund unmatched. |
| `REFUND_EXCEEDS_PAYMENT` | `payment_amount`, `refunded`, `refundable`, and the reference | The payment's matched refunds (stored ones plus earlier refunds of this batch pointing at it) would exceed its amount. It is probably the wrong payment: look again, or ask the user. |

`recategorize_transactions` uses `INVALID_FIELD` (e.g. a missing or blank `reason`),
`CATEGORY_NOT_FOUND` and `CATEGORY_NOT_LEAF` as above, and also:

| Code | Extra fields | What the agent should do |
|---|---|---|
| `DUPLICATE_TRANSACTION` | `transaction_id`, `duplicate_of_index` | The same transaction appears twice in one call. Keep one item. |
| `TRANSACTION_NOT_FOUND` | `transaction_id` | No such transaction (perhaps the user deleted it). Search again with `find_transactions`. |
| `REFUND_CATEGORY_FOLLOWS_PAYMENT` | `category_id`, `refund_of_id` | A matched refund counts in its payment's category. Recategorize the payment instead (its refunds follow), or tell the user. |
| `CATEGORY_UNCHANGED` | `category_id` | The transaction is already in that category. Drop the item. |
| `NOTE_TOO_LONG` | `max_length`, `length` | The note would exceed 1000 characters. Shorten the reason; if it still does not fit, ask the user to tidy the note on the Transactions page. |

Duplicate detection: two transactions are "the same" when **channel**, date, amount (to
the cent), counterparty and description match after normalization (Unicode NFKC, trimmed,
whitespace collapsed, case-insensitive). The note and category do not count. The same
purchase submitted under two different channels is **not** a duplicate, so always submit
a statement under its own channel.

### For the whole request

| Code | HTTP | Meaning / action |
|---|---|---|
| `INVALID_TOKEN` | 401 | Token missing, unknown or revoked. Stop and ask the user for a new token. |
| `TOKEN_SCOPE_FORBIDDEN` | 403 | REST only: an agent token was used on an endpoint other than the seven agent operations. Do not retry. |
| `CHANNEL_NOT_FOUND` | 404 / 422 | Wrong `channel_id` (422 when it is a search filter). Call `list_channels` and ask the user which channel the statement belongs to. |
| `CATEGORY_NOT_FOUND` | 422 | `find_transactions` with a `category_id` that does not exist. Use an id from `list_categories`. |
| `INVALID_DATE_RANGE` | 422 | `find_payments` / `find_transactions`: `date_from` after `date_to`, or a range of more than 366 days (both ends counted). Narrow the range. |
| `INVALID_LIMIT` | 422 | `find_payments` / `find_transactions`: `limit` is not 1 to 50. |
| `BUDGET_ACCOUNT_NOT_FOUND` | 422 | `get_budgets` with a `budget_account_id` that does not exist. Use an id from `list_categories` (`budget_account.id`) or omit it. |
| `SETTINGS_NOT_INITIALIZED` | 409 | `get_budgets` before the user finished the first-time setup (no base currency yet). Ask the user to finish setup in the web UI. |
| `INVALID_BATCH_SIZE` | 422 | `items` empty or more than 500 (100 for `recategorize_transactions`). Split the batch. |
| `INVALID_MONTH` | 422 | `month` is not `YYYY-MM`. |
| `VALIDATION_ERROR` | 422 | REST only: the request body or a parameter itself is malformed (`details.errors`). |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | REST only: send `Content-Type: application/json`. |

Over MCP, these come back as a tool result with `isError: true` whose content is the same
envelope `{"code", "message", "details"}`. A rejected batch is **not** an error result: it is
a normal result with `accepted: false`, so read `details.items`.

## The rules that matter

1. **One channel per batch.** Submit each statement under the channel it comes from;
   duplicates are only detected within a channel.
2. **Any level-2 category, from the whole tree.** The budget account shown on a category
   is for reference; do not pick a category because of its budget account.
3. **Base currency only.** Convert foreign-currency spending at that day's rate before
   submitting.
4. **Batches are all-or-nothing.** If any item is rejected, nothing from the batch is
   stored. Resolve every rejected item, then resubmit the **whole** batch (all items, the
   `ok` ones included). Never assume the `ok` items were saved.
5. **`confirm_duplicate` is single-use.** Set it only after the user explicitly confirmed
   that a reported duplicate is a real, separate transaction, only on that item, and only
   for the one resubmission that follows. Never set it pre-emptively, never set it on a
   whole batch, and never keep it in a batch you retry: an item with the flag and a
   matching record is stored **again** every time it is submitted. On an item with no
   matching record the flag is ignored.
6. **Re-running is safe without flags.** Resubmitting an already stored batch without
   flags stores nothing and returns `SUSPECTED_DUPLICATE` for each item. There is no silent
   "already present, skip": drop those items and submit the rest.
7. **Only the category can be corrected through the agent**, and only when the user asked
   for it or confirmed it, always with a reason (`recategorize_transactions`). Anything
   else of a stored transaction (note, refund match) is fixed or deleted by the user on
   the Transactions page. Its channel, date and amount cannot be changed.
8. **Refunds** are negative amounts. Name the payment each one reverses: `refund_of_index`
   when that payment is in the same batch, otherwise `find_payments` then `refund_of_id`.
   Never guess: if no payment fits (or several do and you cannot tell), ask the user; if
   it is still unknown, submit the refund without either field. Give it the original
   expense's category anyway. A stored match is changed or removed only by the user.
   Transfers between the user's own accounts and credit-card repayments are not
   submitted at all.

## REST equivalents

The MCP tools call the same service functions as these REST endpoints and return the same
payloads. Use them with the same `Authorization: Bearer eg_...` header and
`Content-Type: application/json`. Base URL: `http://<host>:<WEB_PORT>/api/v1`.

| MCP tool | REST |
|---|---|
| `list_channels()` | `GET /channels` (returns the array itself, without the `{"channels": ...}` wrapper) |
| `list_categories()` | `GET /categories` |
| `get_budgets(month, budget_account_id)` | `GET /budgets?month=YYYY-MM&budget_account_id=<id>` (both optional) |
| `find_payments(date_from, date_to, channel_id, counterparty, limit)` | `GET /payments/search?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&channel_id=<id>&counterparty=<text>&limit=<n>` |
| `find_transactions(date_from, date_to, channel_id, category_id, q, kind, limit)` | `GET /transactions/search?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&channel_id=<id>&category_id=<id>&q=<text>&kind=payment\|refund&limit=<n>` |
| `submit_transactions(channel_id, items)` | `POST /channels/{channel_id}/transactions/batch` with body `{"items": [...]}` |
| `recategorize_transactions(items)` | `POST /transactions/recategorize` with body `{"items": [...]}` |

Differences on REST: success is `201` (`200` for `recategorize`) with `{"accepted": true, "transactions": [...]}`;
a rejected batch is HTTP `409` with the envelope
`{"code": "BATCH_REJECTED", "message", "details": {"items": [...]}}` (no `accepted` key);
other errors use the HTTP statuses in the table above. Every other endpoint answers an
agent token with `403 TOKEN_SCOPE_FORBIDDEN`.

The full contract is at `/api/docs` (Swagger UI) and `/api/openapi.json`.

## Upgrading from the account-based version

Earlier versions addressed everything by `account_id` (`list_categories(account_id)`,
`submit_transactions(account_id, items)`, `/accounts/...`). Those tools and routes are
gone. After upgrading, the user sets up the ledger again in the web UI (database
migration 0004 clears the old accounts, categories, budgets and transactions; tokens
keep working), and the agent's instructions should name **channel IDs** instead of
account IDs.
