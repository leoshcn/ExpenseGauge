# Logging Guidelines

> How logging is done in this project.

---

## Overview

The backend logs very little, on purpose: it is a single-user app whose errors are
returned to the caller in a structured envelope. Logging uses the standard library
`logging` module; there is no structured-logging library and no log configuration of
our own. Output goes to stderr through uvicorn's handlers.

What exists today:

- `logger = logging.getLogger("expense_gauge")` in `backend/app/main.py`. Its only use
  is `logger.exception(...)` in the catch-all handler, for unexpected exceptions.
- uvicorn's access log (method, path, status) and startup messages.
- The MCP SDK's own loggers (`mcp.*`): tool failures at INFO, crashes with traceback.
- Alembic's `INFO` lines when migrations run from the CLI (`alembic.ini`).

---

## Log Levels

| Level | Use |
|---|---|
| `ERROR` / `logger.exception` | an unexpected exception, i.e. a bug or an infrastructure failure (the 500 path) |
| `WARNING` | something wrong that the request survived; nothing emits this yet |
| `INFO` | lifecycle events; today only uvicorn, Alembic and the MCP SDK |
| `DEBUG` | not used |

An `AppError` is an expected outcome (bad input, duplicate, forbidden) and is **not**
logged by our code: the client receives the full explanation.

---

## Structured Logging

Not used. When adding a log line, get a module logger under the `expense_gauge`
namespace (`logging.getLogger("expense_gauge.<area>")`), use `%s` arguments rather than
f-strings, and identify records by ID:

```python
logger.exception("Unhandled error on %s %s", request.method, request.url.path)
```

---

## What to Log

- Unexpected exceptions, once, where they are converted into the 500 envelope.
- If background or start-up work is added later: its start, end and failures.

---

## What NOT to Log

- Passwords, session cookie values, raw agent tokens (`eg_...`) or the
  `Authorization` header. Only hashes are stored and nothing derived from them is logged.
- Request bodies. Transactions carry counterparties, descriptions and notes, which
  are personal financial data; log IDs and counts instead.
- `DATABASE_URL` (it contains the password).
