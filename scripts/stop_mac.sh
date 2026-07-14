#!/usr/bin/env bash
#
# FinAlly — stop script (macOS / Linux)
#
#   ./scripts/stop_mac.sh    Stop and remove the container.
#
# Your data is safe: the SQLite database lives in ./db on the host (bind-
# mounted into the container), so it is never touched by this script.
# Idempotent: running it when nothing is up is a no-op, not an error.

set -euo pipefail

CONTAINER_NAME="finally"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on your PATH." >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon isn't running — nothing to stop."
  exit 0
fi

if [ -z "$(docker ps --all --quiet --filter "name=^/${CONTAINER_NAME}$")" ]; then
  echo "FinAlly isn't running — nothing to stop."
  exit 0
fi

echo "Stopping FinAlly ..."
docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true
docker rm "$CONTAINER_NAME" >/dev/null 2>&1 || true

echo "FinAlly stopped. Your portfolio data is preserved in ./db"
