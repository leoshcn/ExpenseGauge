# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

A change is done when, run from `backend/`:

```bash
uv run ruff check .                       # no findings
uv run pytest                             # all pass
uv run python -m scripts.export_openapi   # if the API changed; commit openapi.json
```

Ruff is configured in `backend/pyproject.toml`: line length 100, rule sets
`E, F, I, UP, B, SIM`. Code is formatted with `uv run ruff format .`. Chinese
characters count double towards the line length, so wrap long Chinese messages.

---

## Forbidden Patterns

- **Rules outside `app/services/`.** Routers and MCP tools are thin and call the same
  service function. No validation, no query, no `commit` in `app/routers/` or `app/mcp/`.
- **SQLite or a mocked database in tests.** Tests use a real PostgreSQL.
- **`float` for money.** `Decimal` and `NUMERIC(14,2)` only.
- **`HTTPException` or ad-hoc error bodies.** Raise `AppError` (see `error-handling.md`).
- **An endpoint without an auth dependency.** Each one takes `SessionPrincipal` or
  `AnyPrincipal` (`app/deps.py`), except the public ones listed in `PUBLIC` in
  `tests/test_auth.py`. Outside the API router, `/api/docs` and `/api/openapi.json`
  are served without credentials (they describe the API and hold no data).
- **`include_in_schema=False` on an endpoint.** The auth tests walk the OpenAPI
  document; `test_route_walk_sees_every_registered_endpoint` fails for a hidden one.
- **Widening the agent scope by accident.** `AnyPrincipal` is for exactly three
  operations: GET categories, GET budgets, POST transactions batch. Using it anywhere
  else fails `test_agent_token_reaches_only_the_three_agent_operations`; changing that
  list is a product decision, not a refactor.
- **Storing or returning secrets.** Passwords are argon2 hashes; session values and
  agent tokens are stored as SHA-256 only. A raw token appears once, in the response
  of `POST /tokens`.
- **Letting an agent change stored data.** Agent-reachable operations only read or insert.
- **Hand-editing `backend/openapi.json`.** It is generated.

---

## Required Patterns

- Request models extend `RequestSchema` (unknown fields rejected); response models
  extend `Schema`; every endpoint declares `response_model`.
- Shared field types come from `app/schemas/common.py`: `Money`, `Month`, `Name`.
- Month strings are converted only through `app/months.py`.
- Blocking work from async code runs in a worker thread: services are synchronous, so
  MCP tools and the Bearer middleware call them through `_run` in `app/mcp/server.py`.
  REST endpoints are plain `def`, which FastAPI runs in its thread pool.
- State-changing REST requests with a body must be `application/json`
  (`require_json_body`, applied to the whole API router) - the CSRF guard that
  complements the `SameSite=Lax` session cookie.
- Settings are read through `get_settings()`, never from `os.environ` in app code.
- New settings are added to `Settings` in `app/config.py` and to `.env.example`.

---

## Testing Requirements

- Tests go through HTTP with `TestClient` (or the MCP SDK client), not by calling
  services directly; pure functions such as `compute_fingerprint` are the exception.
- Fixtures in `tests/conftest.py`: `anon` (no credentials), `client` (signed-in user),
  `agent` (Bearer token only), `ledger` (an account with a small category tree and
  helpers `item`, `submit`, `set_budgets`, `count`).
- Tables are truncated before every test; tests do not depend on each other.
- PostgreSQL: `TEST_DATABASE_URL` if set (database name must contain `test`), else an
  embedded server started by the `pgserver` dev dependency in `backend/.pgdata/`.
- Error responses are asserted with `assert_envelope(response, status, code)`.
- Each acceptance criterion has a test whose docstring names it (`"""AC9"""`).
- A new endpoint is covered automatically by the route-walking auth tests in
  `tests/test_auth.py`; add it to `PUBLIC` or `AGENT_ALLOWED` only on purpose.
- Anything that touches batch submission keeps `tests/test_concurrency.py` passing.
- An MCP change is tested over real HTTP against uvicorn (`tests/test_mcp.py`) and
  compared with the REST response for the same input.
- `tests/test_schema.py` guards three things: migrations equal models, `openapi.json`
  is current, every operation documents the error envelope.

---

## Code Review Checklist

- [ ] Is every new rule in a service, and reused by both REST and MCP where relevant?
- [ ] Does every failure path raise `AppError` with an English code and a Chinese message?
- [ ] Is the endpoint's auth dependency the narrowest that works (session only by default)?
- [ ] Are money values `Decimal` end to end, and months handled through `app/months.py`?
- [ ] Does a write that reads-then-decides hold the right advisory lock for the whole transaction?
- [ ] Is there a migration with a `downgrade`, and does `test_migrations_match_models` pass?
- [ ] Was `openapi.json` regenerated, and do response shapes still match what the frontend uses?
- [ ] Do the tests fail when the change is reverted?
