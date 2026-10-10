# Deployment

> How ExpenseGauge is packaged and run. Written from `docker-compose.yml`,
> `backend/Dockerfile`, `backend/docker-entrypoint.sh`, `frontend/Dockerfile` and
> `frontend/nginx.conf`. User-facing commands are in the root `README.md`.

---

## Topology

```
host :${WEB_PORT:-8080} ──> web (nginx)  /         frontend build (SPA fallback)
                                         /api/     ──> api:8000
                                         /mcp(/)   ──> api:8000   (unbuffered)
                            api (uvicorn, one process: REST + mounted MCP app) ──> db:5432
                            db  (postgres:16-alpine, named volume db-data)
```

- **Only `web` publishes a port.** `api` and `db` are reachable on the compose network
  only. Do not add `ports:` to them; for debugging use `docker compose exec`.
- The browser sees one origin (nginx), which is what lets the HttpOnly, SameSite=Lax
  session cookie work. The Vite dev proxy reproduces the same in development.
- Startup order is enforced with healthchecks and `depends_on: condition:
  service_healthy`: `db` (`pg_isready`) -> `api` (`GET /api/v1/health` from inside the
  container) -> `web` (`GET /healthz`, answered by nginx itself). All three use
  `restart: unless-stopped`.

## Images

| Image | Base | Notes |
|---|---|---|
| `backend/Dockerfile` | `python:3.12-slim` (two stages) | `uv sync --frozen --no-dev --no-install-project` from `uv.lock` into `/app/.venv` with the uv binary copied from `ghcr.io/astral-sh/uv`; runtime stage copies the venv, `alembic/`, `alembic.ini` and `app/` only; runs as uid 10001 |
| `frontend/Dockerfile` | `node:24-slim` -> `nginx:1.28-alpine` | `npm ci` then `npm run build` (type check + Vite); the build uses the committed `src/api/schema.gen.ts`, it does not need the backend |

- Dependencies change only through the lockfiles (`uv.lock`, `package-lock.json`). A
  dependency added to `pyproject.toml` without `uv lock` fails the image build
  (`--frozen`).
- Dev-only Python packages (`pytest`, `ruff`, `pgserver`, `httpx`) are not in the image.
  Never import them from `app/`.
- Build contexts are `backend/` and `frontend/`; their `.dockerignore` files keep
  `.venv`, `.pgdata`, `node_modules`, `dist`, tests and screenshots out.
- Node needs `^22.22.2 || ^24.15.0 || >=26` (engines in the lockfile); keep the build
  stage on a matching image. The build stage caps the heap at 1.5 GB
  (`NODE_OPTIONS`) so it fits a 2 GB host.

## API container start

`docker-entrypoint.sh` (must stay LF; `.gitattributes` enforces `*.sh eol=lf`):

1. `alembic upgrade head` - every start migrates; a failing migration stops the
   container (and `web` never becomes ready).
2. `exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers
   --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}"`. Trusting any forwarder is fine
   because only nginx can reach the container.

So a new migration needs nothing but the migration file: the next `docker compose up
-d --build` applies it.

## Configuration

All configuration comes from `.env` next to `docker-compose.yml` (template:
`.env.example`, committed; `.env` is git-ignored).

| Variable | Used by | Notes |
|---|---|---|
| `WEB_PORT` | compose | host port of `web`, default 8080 |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `db`, and `api`'s `DATABASE_URL` | required (`${VAR:?}`); the password goes into a URL, so letters and digits only |
| `SESSION_COOKIE_SECURE` | `api` | `false` for plain-HTTP LAN; `true` only behind HTTPS |
| `SESSION_TTL_DAYS`, `LOGIN_FAILURE_DELAY_SECONDS` | `api` | defaults 30 and 1.0 |
| `DATABASE_URL` | local runs only | compose builds its own URL with host `db` and ignores this |

When a new setting is added to `app/config.py`, add it to `.env.example` **and** to the
`api` service's `environment:` in `docker-compose.yml` (compose passes only the listed
variables).

## nginx rules (`frontend/nginx.conf`)

- `proxy_pass` uses a variable with Docker's resolver (`127.0.0.11`), so a recreated
  `api` container is found at its new address without restarting `web`.
- Proxied requests carry `Host`, `X-Real-IP`, `X-Forwarded-For`, `-Proto`, `-Host`.
- `location ~ ^/mcp/?$`: both `/mcp` and `/mcp/` are passed unchanged; the backend's
  `McpPathMiddleware` serves both without a redirect. `proxy_buffering off`,
  `proxy_request_buffering off`, `gzip off`, read/send timeouts 3600 s, so streamed MCP
  responses are not held back. Keep this when touching the file.
- `/assets/` (Vite's content-hashed files): `Cache-Control: public, max-age=31536000,
  immutable`. Everything else falls back to `index.html` with `Cache-Control: no-cache`.
- `client_max_body_size 4m` covers a 500-item batch.

## Data

- PostgreSQL data is the named volume `expense-gauge_db-data`. `docker compose down`
  keeps it; `down -v` deletes it (a clean install, back to first-time setup).
- Backup and restore use `pg_dump` / `psql` through `docker compose exec -T db` (README).
- `POSTGRES_*` are read by the image only when the volume is empty; changing them later
  does not change the existing database.

## Verifying a deployment

The end-to-end walk used for the MVP is kept in
`.trellis/tasks/10-10-mvp-integration/` (`e2e_walk.py`, `e2e_browser.mjs`,
`e2e-results.md`). It needs a stack with no user and runs from a machine with `uv` and
the frontend's `node_modules`:

```bash
cd backend
uv run python ../.trellis/tasks/10-10-mvp-integration/e2e_walk.py walk http://HOST:8080
```

## Common mistakes

- Publishing `api` or `db` ports "for convenience" - breaks the single-origin cookie model
  and exposes the database.
- CRLF in `docker-entrypoint.sh` (Windows checkout without the `.gitattributes` rule):
  the container fails with `/bin/sh^M: not found`.
- Turning on gzip or buffering for `/mcp`.
- Adding a config variable to `Settings` but not to `docker-compose.yml`.
