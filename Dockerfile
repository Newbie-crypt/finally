# syntax=docker/dockerfile:1
#
# FinAlly — AI Trading Workstation
# Multi-stage build: Node builds the Next.js static export, Python serves
# everything (API + static files) from a single FastAPI app on port 8000.

# ---------------------------------------------------------------------------
# Stage 1 — Build the frontend (Next.js static export -> frontend/out)
# ---------------------------------------------------------------------------
FROM node:20-slim AS frontend-builder

WORKDIR /build

# Copy manifests first so `npm install` is cached independently of source edits.
# The glob keeps this working whether or not a package-lock.json is committed.
COPY frontend/package.json frontend/package-lock.json* ./

RUN npm install

# Now the rest of the frontend source.
COPY frontend/ ./

# next.config sets `output: 'export'` -> static site is emitted to /build/out
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2 — Python runtime (FastAPI + uv), serves API and the static export
# ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime

# uv, straight from the official distroless image (no pip bootstrap needed).
# Builds are still reproducible where it counts: uv.lock pins every dependency.
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /usr/local/bin/

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # Install into /app/.venv rather than a cache-hostile ephemeral path.
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    # Put the project venv ahead of the system interpreter.
    PATH="/app/.venv/bin:$PATH" \
    # Where the backend serves the static frontend from, and where SQLite lives.
    # Both match PLAN.md §4/§11; the db path is the bind-mount target.
    FINALLY_STATIC_DIR=/app/static \
    FINALLY_DB_PATH=/app/db/finally.db

WORKDIR /app

# Dependency layer: only re-resolves when the lockfile/manifest changes.
# --no-install-project: the app is run from source (/app/app), not installed as
# a wheel, so we skip the build backend and keep the layer purely dependencies.
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev

# Application source. `app/` and `schema/` are the backend's two owned trees
# (PLAN.md §4); everything else in backend/ is dev tooling and tests.
COPY backend/app/ ./app/
COPY backend/schema/ ./schema/

# Static frontend export, served by FastAPI at /* on the same origin.
COPY --from=frontend-builder /build/out/ ./static/

# Bind-mount target for the SQLite database (docker run -v ./db:/app/db).
# Created here so the image is still runnable without a mount.
RUN mkdir -p /app/db

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health', timeout=4).status == 200 else 1)"

# Single worker, deliberately: SQLite allows one writer, and multiple Uvicorn
# workers would race on it ("database is locked"). See PLAN.md §11 Concurrency.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
