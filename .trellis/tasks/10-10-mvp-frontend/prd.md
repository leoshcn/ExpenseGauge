# ExpenseGauge MVP frontend

## Goal

Deliver the web UI in `frontend/`: setup, login, onboarding, dashboard, transactions, budgets, settings, in Simplified Chinese, with a high standard of visual design.

## Parent Artifacts (authoritative, read first)

- `.trellis/tasks/10-10-expense-gauge-mvp/prd.md` - requirements R1-R10, acceptance criteria AC1-AC18, out of scope
- `.trellis/tasks/10-10-expense-gauge-mvp/design.md` - architecture, repository layout, data model, API contract, MCP, auth, frontend
- `.trellis/tasks/10-10-expense-gauge-mvp/implement.md` - ordered steps, validation commands, risky points

If this file and a parent artifact disagree, the parent wins; report the mismatch instead of guessing.

## Scope

Parent `implement.md` steps 8-9 (9a then 9b).

## Dependencies

- Requires the backend child task (`.trellis/tasks/10-10-mvp-backend`) to be complete: the client is generated from `backend/openapi.json`, and pages are exercised against the running API.

## Requirements

- Parent R8, R9 and the frontend side of R1.
- React + TypeScript + Vite, React Router, TanStack Query, `openapi-typescript` client, shadcn/ui + Tailwind CSS, Recharts via the shadcn/ui chart wrappers.
- Design tokens as CSS variables with light and dark themes; charts take colours and typography from the same tokens.
- All copy in `src/strings.zh.ts`.
- **Visual checkpoint:** after step 9a (design spec + Dashboard), stop and hand back for the user's visual approval. Do not build 9b pages before that approval.
- Fill `.trellis/spec/frontend/*.md` with the conventions actually used, citing real files.

## Acceptance Criteria

- [ ] Parent AC2, AC3 (UI flow), AC5 (token shown once), AC12, AC13, AC14, AC15 work in the browser against the real API.
- [ ] The user has approved the Dashboard's visual design.
- [ ] Type check, lint and unit tests pass; the API client is generated from `backend/openapi.json`, not hand-written.
- [ ] `.trellis/spec/frontend/` files no longer contain template placeholders.

## Out of Scope

- Backend changes other than defects found while integrating (report them; fix only with the main session's agreement).
- Dockerfiles, nginx, compose.
