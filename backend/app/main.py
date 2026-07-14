"""FinAlly FastAPI application — API routes, SSE streaming, and the static frontend.

Entrypoint: ``app.main:app`` (the Dockerfile runs uvicorn against this exact path).
"""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.requests import Request
from starlette.responses import Response

from app import portfolio, watchlist
from app.chat import router as chat_router
from app.market import PriceCache, create_market_data_source, create_stream_router
from schema import init_db

logging.basicConfig(
    level=os.environ.get("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s %(levelname)-8s %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

STATIC_DIR_ENV_VAR = "FINALLY_STATIC_DIR"
_BACKEND_DIR = Path(__file__).resolve().parents[1]


def resolve_static_dir() -> Path | None:
    """Locate the built frontend, or None if it hasn't been built yet.

    ``FINALLY_STATIC_DIR`` wins (the Dockerfile sets it to ``/app/static``); otherwise
    fall back to ``backend/../frontend/out``, the Next.js export path in a dev checkout.
    A missing directory is not fatal — the API still serves, only the UI is absent.
    """
    override = os.environ.get(STATIC_DIR_ENV_VAR, "").strip()
    candidate = Path(override) if override else _BACKEND_DIR.parent / "frontend" / "out"
    return candidate if (candidate / "index.html").is_file() else None


class SPAStaticFiles(StaticFiles):
    """StaticFiles that falls back to index.html for unknown paths.

    The frontend is a Next.js static export with client-side routing, so a request for a
    route with no file on disk must still return the app shell. With ``html=True``,
    Starlette answers a miss with a 404 (raised, or its own 404.html) — both become the
    app shell here.

    Unmatched ``/api/*`` paths are the exception: this mount is the last route in the app,
    so a typo'd or not-yet-wired API path lands here, and it must stay JSON rather than be
    handed the HTML shell.
    """

    async def get_response(self, path: str, scope) -> Response:
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as err:
            if err.status_code != 404:
                raise
        else:
            if response.status_code != 404:
                return response

        if scope.get("path", "").startswith("/api/"):
            raise StarletteHTTPException(
                status_code=404, detail=f"No such endpoint: {scope['path']}"
            )
        return FileResponse(Path(str(self.directory)) / "index.html")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start the market data feed and the periodic snapshot task; stop them on shutdown."""
    init_db()

    price_cache = PriceCache()
    source = create_market_data_source(price_cache)

    # An empty watchlist (the user removed everything) is legal — the source just starts
    # with no tickers and picks them up as they're added.
    tickers = await asyncio.to_thread(watchlist.get_watchlist_tickers)
    await source.start(tickers)

    app.state.price_cache = price_cache
    app.state.market_source = source

    snapshot_task = asyncio.create_task(
        portfolio.snapshot_loop(price_cache), name="portfolio-snapshots"
    )
    app.state.snapshot_task = snapshot_task
    logger.info("FinAlly backend ready (%d tickers tracked)", len(tickers))

    try:
        yield
    finally:
        snapshot_task.cancel()
        try:
            await snapshot_task
        except asyncio.CancelledError:
            pass
        await source.stop()
        logger.info("FinAlly backend shut down")


def create_app() -> FastAPI:
    """Build the FastAPI application."""
    application = FastAPI(
        title="FinAlly",
        description="AI Trading Workstation — live market data, simulated portfolio, AI copilot",
        version="0.1.0",
        lifespan=lifespan,
    )

    @application.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> JSONResponse:
        """Uniform error body across the API: ``{"error": "..."}`` (PLAN.md §9)."""
        return JSONResponse(status_code=exc.status_code, content={"error": exc.detail})

    @application.get("/api/health", tags=["system"])
    def health() -> JSONResponse:
        """Health check (Docker HEALTHCHECK targets this path)."""
        return JSONResponse({"status": "ok"})

    # The SSE router needs the cache, which only exists once lifespan has run; read it
    # off app.state lazily through a proxy so the router can be built at import time.
    stream_cache = _LazyPriceCache(application)

    application.include_router(create_stream_router(stream_cache))  # type: ignore[arg-type]
    application.include_router(portfolio.router)
    application.include_router(watchlist.router)
    application.include_router(chat_router)

    static_dir = resolve_static_dir()
    if static_dir:
        application.mount("/", SPAStaticFiles(directory=static_dir, html=True), name="static")
        logger.info("Serving frontend from %s", static_dir)
    else:
        logger.warning(
            "No frontend build found (set %s or build frontend/out) — serving API only",
            STATIC_DIR_ENV_VAR,
        )

    return application


class _LazyPriceCache:
    """Proxies PriceCache reads to ``app.state.price_cache``, which exists only after startup."""

    def __init__(self, application: FastAPI) -> None:
        self._app = application

    def __getattr__(self, name: str):
        cache: PriceCache = self._app.state.price_cache
        return getattr(cache, name)


app = create_app()
