# ExpenseGauge MVP backend

## Goal

Deliver the complete backend in `backend/`: REST API, data model and migrations, auth, batch transaction submission with agent-readable feedback, dashboard summaries, and the MCP server mounted at `/mcp`.

## Parent Artifacts (authoritative, read first)

- `.trellis/tasks/10-10-expense-gauge-mvp/prd.md` - requirements R1-R10, acceptance criteria AC1-AC18, out of scope
- `.trellis/tasks/10-10-expense-gauge-mvp/design.md` - architecture, repository layout, data model, API contract, MCP, auth, frontend
- `.trellis/tasks/10-10-expense-gauge-mvp/implement.md` - ordered steps, validation commands, risky points

If this file and a parent artifact disagree, the parent wins; report the mismatch instead of guessing.

## Scope

Parent `implement.md` steps 1-7. In step 1, scaffold only the backend, the root `.gitignore`, `.env.example` and a root README stub; `frontend/` and `docker-compose.yml` belong to the other child tasks.

## Dependencies

- None. This task goes first.
- Its output contract for the other tasks: the OpenAPI document. Export it to `backend/openapi.json` with a documented command so the frontend can generate its client without a running server.

## Requirements

- Everything in parent R2-R7 and the backend side of R1, R3, R9.
- Python 3.12 managed by `uv`; SQLAlchemy 2.x, Alembic, Pydantic v2, pytest, ruff.
- Tests run against a real PostgreSQL reached through a `TEST_DATABASE_URL` environment variable. Do not substitute SQLite.
- Every non-2xx response uses the error envelope from the design, with an English `code` and a Chinese `message`.
- Fill `.trellis/spec/backend/*.md` with the conventions actually used, citing real files.

## Acceptance Criteria

- [ ] Parent AC2, AC4, AC5, AC6, AC7, AC8, AC9, AC10, AC11, AC12, AC15, AC16 are each covered by at least one automated test that passes.
- [ ] Backend parts of AC13 and AC14 (summary endpoints; transaction patch/delete reflected in summaries) are covered by passing tests.
- [ ] A test submits two overlapping batches concurrently and shows the duplicate check holds.
- [ ] `uv run ruff check .` and `uv run pytest` pass in `backend/`.
- [ ] `backend/openapi.json` is generated.
- [ ] `.trellis/spec/backend/` files no longer contain template placeholders.

## Out of Scope

- `frontend/`, Dockerfiles, `docker-compose.yml`, nginx, `docs/agent-guide.md`.
