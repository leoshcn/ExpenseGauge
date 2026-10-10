#!/bin/sh
# Migrates the database, then serves the API. Only nginx (the `web` service) reaches this
# container, so forwarded headers are trusted from any address on the compose network.
set -eu

alembic upgrade head

exec uvicorn app.main:app \
    --host 0.0.0.0 \
    --port 8000 \
    --proxy-headers \
    --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-*}" \
    --no-server-header
