# Error Handling

> How errors are handled in this project.

---

## Overview

Every non-2xx response, from any endpoint, has one shape, so the frontend and agents
handle a single format:

```json
{ "code": "CATEGORY_IN_USE", "message": "该分类下已有流水，无法删除", "details": {} }
```

- `code`: stable English `UPPER_SNAKE_CASE`. Clients branch on this.
- `message`: Simplified Chinese, fit to show to the user or for an agent to relay.
- `details`: always an object, possibly empty.

The Pydantic model is `ErrorEnvelope` in `backend/app/errors.py`; it is declared as the
`default` and `422` response of every operation in `app/routers/__init__.py`, so it is
in `openapi.json`.

---

## Error Types

There is one application exception: `AppError(status_code, code, message, details)` in
`app/errors.py`, with three shorthands: `not_found(code, message)` (404),
`conflict(code, message, details)` (409) and `invalid(code, message, details)` (422).

Status code conventions:

| Status | Meaning | Codes in use |
|---|---|---|
| 401 | no or bad credentials | `UNAUTHENTICATED`, `INVALID_TOKEN`, `INVALID_CREDENTIALS` |
| 403 | agent token on a session-only endpoint | `TOKEN_SCOPE_FORBIDDEN` |
| 404 | addressed resource does not exist | `ACCOUNT_NOT_FOUND`, `CATEGORY_NOT_FOUND`, `TRANSACTION_NOT_FOUND`, `TOKEN_NOT_FOUND`, `NOT_FOUND` |
| 405 | method not allowed | `METHOD_NOT_ALLOWED` |
| 409 | conflicts with stored state | `USER_ALREADY_EXISTS`, `ACCOUNT_NAME_TAKEN`, `CATEGORY_NAME_TAKEN`, `CATEGORY_IN_USE`, `CATEGORY_HAS_CHILDREN`, `BATCH_REJECTED` |
| 415 | state-changing body is not JSON | `UNSUPPORTED_MEDIA_TYPE` |
| 422 | the request itself is wrong | `VALIDATION_ERROR`, `INVALID_MONTH`, `INVALID_MONTH_RANGE`, `INVALID_PARENT`, `INVALID_BATCH_SIZE`, `DUPLICATE_CATEGORY`, and `CATEGORY_NOT_FOUND` / `CATEGORY_NOT_LEAF` when the category came in the body or query |
| 500 | bug | `INTERNAL_ERROR` |

`CATEGORY_NOT_FOUND` is 404 when the category is the URL's resource
(`PATCH /categories/{id}`) and 422 when it is a value inside the request.

---

## Error Handling Patterns

- **Services raise `AppError`; nothing else is caught on the way up.** Routers contain
  no `try`. `app/main.py::_register_error_handlers` turns exceptions into the envelope:
  `AppError` as is; `RequestValidationError` into 422 `VALIDATION_ERROR` with
  `details.errors = [{field, reason}]` (`field` is the dotted location, for example
  `body.password`); Starlette HTTP errors into `NOT_FOUND` / `METHOD_NOT_ALLOWED`;
  anything else into 500 `INTERNAL_ERROR`, logged with its traceback.
- **Do not raise `HTTPException`** and do not return error dicts from routers.
- Database integrity errors are caught only where they are an expected outcome, rolled
  back, and re-raised as `AppError` (`_commit_name` in `services/categories.py`).
- Look-up helpers raise instead of returning `None`: `get_account`, `get_category`.
- Request bodies reject unknown fields (`RequestSchema`, `extra="forbid"`), so a
  misspelt or non-editable field is a 422 rather than being silently ignored.

---

## API Error Responses

### Batch submission feedback

`services/transactions.py::submit_batch` validates items itself instead of letting the
request model do it, so a bad item is reported per item and never fails the request as a
whole. If any item is rejected, nothing is written and the response is 409:

```json
{
  "code": "BATCH_REJECTED",
  "message": "本批共 3 条，其中 1 条被拒绝，未写入任何数据",
  "details": { "items": [
    { "index": 0, "status": "ok" },
    { "index": 1, "status": "rejected", "code": "SUSPECTED_DUPLICATE", "message": "…",
      "existing": { "id": 12, "…": "…" }, "hint": "与用户确认后，带 confirm_duplicate=true 重新提交该条" },
    { "index": 2, "status": "ok" }
  ] }
}
```

`details.items` has exactly one entry per submitted item, in order. Each item gets at
most one code, checked in this order:

| Code | Extra fields | When |
|---|---|---|
| `INVALID_FIELD` | `errors: [{field, reason}]` | a field is missing, malformed, unknown, contains U+0000, or amount is 0 |
| `CATEGORY_NOT_FOUND` | `valid_categories` (the account's tree) | unknown category or one of another account |
| `CATEGORY_NOT_LEAF` | `parent {id, name}`, `children [{id, name}]` | a level-1 category |
| `SUSPECTED_DUPLICATE` | `existing` (the stored record), `hint` | fingerprint matches a stored transaction, no flag |
| `DUPLICATE_IN_BATCH` | `duplicate_of_index`, `hint` | fingerprint matches an earlier item of the batch, no flag |

In a batch the first occurrence of a fingerprint is `ok`; each later one needs
`confirm_duplicate: true`. The flag on an item with no match is ignored.

### MCP

`app/mcp/server.py` maps service results as follows:

- success: the REST payload as `structuredContent`;
- `BATCH_REJECTED`: a normal result (`isError` false) `{"accepted": false, code, message, details}`,
  so the agent reads the per-item feedback;
- any other `AppError`: `isError` true with the envelope as `structuredContent` and as
  JSON text;
- a missing, invalid or revoked token: HTTP 401 with the envelope, before MCP is reached;
- arguments the tool signature rejects (for example an item that is not an object) and
  unexpected exceptions: the SDK's own `isError` text result, without the envelope. The
  SDK does not include the exception text for an unexpected exception.

---

## Common Mistakes

- **Validating batch items with the request model.** A single bad item would then turn
  the whole request into a top-level 422 and the agent would get no per-item feedback.
  The request model keeps items as raw objects (`RawTransactionItem`), documented with
  the schema of `TransactionItemIn`.
- **English or missing `message`.** Tests use `assert_envelope` (`tests/test_auth.py`),
  which checks the exact key set and that the message contains Chinese.
- **Adding a rule to a router or an MCP tool.** The other interface would then behave
  differently; `tests/test_mcp.py` compares MCP results with the REST responses.
- **Leaving a session dirty after a failed commit.** Roll back before raising.
