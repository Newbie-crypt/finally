#!/usr/bin/env bash
#
# FinAlly — start script (macOS / Linux)
#
#   ./scripts/start_mac.sh            Build the image if missing, then run.
#   ./scripts/start_mac.sh --build    Force a rebuild, then run.
#   ./scripts/start_mac.sh --open     Open the app in your browser once it's up.
#   ./scripts/start_mac.sh --help
#
# Idempotent: safe to run repeatedly. If the container is already running it
# just tells you where it is; a stale/exited container is replaced.

set -euo pipefail

IMAGE_NAME="finally:latest"
CONTAINER_NAME="finally"
PORT="8000"
URL="http://localhost:${PORT}"

# Resolve the project root from this script's location, so the script works
# from any working directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

FORCE_BUILD=false
OPEN_BROWSER=false

for arg in "$@"; do
  case "$arg" in
    --build) FORCE_BUILD=true ;;
    --open)  OPEN_BROWSER=true ;;
    -h|--help)
      sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^#\{1,2\} \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

cd "$PROJECT_ROOT"

# --- Preflight -------------------------------------------------------------

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not on your PATH." >&2
  echo "Install Docker Desktop: https://www.docker.com/products/docker-desktop" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "Error: the Docker daemon isn't running. Start Docker Desktop and retry." >&2
  exit 1
fi

if [ ! -f .env ]; then
  if [ -f .env.example ]; then
    echo "No .env found — creating one from .env.example."
    cp .env.example .env
    echo "  -> Edit .env and add your OPENROUTER_API_KEY for AI chat to work."
  else
    echo "Error: neither .env nor .env.example exists in ${PROJECT_ROOT}." >&2
    exit 1
  fi
fi

# The SQLite database lives here on the host, bind-mounted to /app/db.
mkdir -p db

# --- Build -----------------------------------------------------------------

if [ "$FORCE_BUILD" = true ] || ! docker image inspect "$IMAGE_NAME" >/dev/null 2>&1; then
  echo "Building ${IMAGE_NAME} ..."
  docker build -t "$IMAGE_NAME" .
else
  echo "Image ${IMAGE_NAME} already built (use --build to rebuild)."
fi

# --- Run -------------------------------------------------------------------

# Already running? Nothing to do — keep this idempotent.
if [ -n "$(docker ps --quiet --filter "name=^/${CONTAINER_NAME}$")" ]; then
  echo "FinAlly is already running at ${URL}"
else
  # Remove a stopped container of the same name so `docker run` won't collide.
  if [ -n "$(docker ps --all --quiet --filter "name=^/${CONTAINER_NAME}$")" ]; then
    echo "Removing previous (stopped) container ..."
    docker rm --force "$CONTAINER_NAME" >/dev/null
  fi

  echo "Starting FinAlly ..."
  docker run --detach \
    --name "$CONTAINER_NAME" \
    --publish "${PORT}:8000" \
    --volume "${PROJECT_ROOT}/db:/app/db" \
    --env-file .env \
    --restart unless-stopped \
    "$IMAGE_NAME" >/dev/null
fi

# --- Wait for health -------------------------------------------------------

printf "Waiting for FinAlly to come up "
for _ in $(seq 1 40); do
  if curl --silent --fail --max-time 2 "${URL}/api/health" >/dev/null 2>&1; then
    echo ""
    echo "FinAlly is live: ${URL}"
    if [ "$OPEN_BROWSER" = true ]; then
      if command -v open >/dev/null 2>&1; then open "$URL"
      elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
      fi
    fi
    exit 0
  fi
  printf "."
  sleep 1
done

echo ""
echo "FinAlly didn't report healthy within 40s. Recent logs:" >&2
docker logs --tail 40 "$CONTAINER_NAME" >&2 || true
echo "" >&2
echo "The container may still be starting — check ${URL} or run: docker logs -f ${CONTAINER_NAME}" >&2
exit 1
