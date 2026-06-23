#!/usr/bin/env bash
# AssetIQ container entrypoint.
#
# Installs Python requirements on every start. Because the project is bind-
# mounted and the in-app updater restarts the container after pulling new code,
# this means an update that adds a new library self-heals on restart — no manual
# `docker compose build` needed. When requirements are unchanged this is a fast
# no-op.
set -e

REQ="/app/app/requirements.txt"
if [ -f "$REQ" ]; then
  echo "[entrypoint] ensuring Python dependencies are installed…"
  pip install --no-cache-dir -r "$REQ" || echo "[entrypoint] pip install reported an issue; continuing"
fi

echo "[entrypoint] starting AssetIQ"
exec uvicorn app.main:app --host 0.0.0.0 --port 9920
