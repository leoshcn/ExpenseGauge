# ExpenseGauge MVP integration and deployment

## Goal

Package and prove the whole system: Docker Compose deployment behind nginx, the agent integration guide, final spec pass, and an end-to-end walk through the acceptance criteria.

## Parent Artifacts (authoritative, read first)

- `.trellis/tasks/10-10-expense-gauge-mvp/prd.md` - requirements R1-R10, acceptance criteria AC1-AC18, out of scope
- `.trellis/tasks/10-10-expense-gauge-mvp/design.md` - architecture, repository layout, data model, API contract, MCP, auth, frontend
- `.trellis/tasks/10-10-expense-gauge-mvp/implement.md` - ordered steps, validation commands, risky points

If this file and a parent artifact disagree, the parent wins; report the mismatch instead of guessing.

## Scope

Parent `implement.md` steps 10-12.

## Dependencies

- Requires both the backend and frontend child tasks to be complete.
- Requires a working Docker engine on the machine for step 12.

## Requirements

- Parent R1 (deployment), R10.
- `docker-compose.yml` with `web`, `api`, `db`; only `web` published; named volume for `db`; migrations on `api` start; configuration from `.env` with a committed `.env.example`.
- nginx serves the frontend build and proxies `/api` and `/mcp` (streaming-safe: no response buffering on `/mcp`).
- `docs/agent-guide.md`: workflow, Hermes Agent config snippet (re-verify against the official docs; see `.trellis/tasks/10-10-expense-gauge-mvp/research/hermes-agent-mcp.md`), the three tools, reason codes, and the rule that `confirm_duplicate` is single-use.
- README: run, first-time setup, backup with `pg_dump`.

## Acceptance Criteria

- [ ] Parent AC1: clean `docker compose up` brings up three services with only `web` published.
- [ ] Parent AC16 through nginx: an MCP client calls all three tools at `/mcp` with a Bearer token.
- [ ] Parent AC2-AC15 walked once on the composed stack, results recorded in this task directory.
- [ ] Parent AC17 and AC18.

## Out of Scope

- HTTPS, public exposure, CI pipelines.
