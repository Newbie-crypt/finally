"""Watchlist endpoints and services (PLAN.md §8).

The service functions (`list_watchlist`, `add_to_watchlist`, `remove_from_watchlist`,
`get_watchlist_tickers`) are the reusable core; the router is a thin shell over them so
other modules (e.g. the chat/LLM layer) can drive watchlist changes without HTTP.
"""

from __future__ import annotations

import logging
import sqlite3
import uuid

from fastapi import APIRouter, HTTPException, Request

from app.market import MarketDataSource, PriceCache
from app.models import WatchlistItem, WatchlistMutationResponse, WatchlistRequest, WatchlistResponse
from schema import DEFAULT_USER_ID, db_session, utc_now_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/watchlist", tags=["watchlist"])


# --- Services (usable without HTTP) ---


def get_watchlist_tickers(conn: sqlite3.Connection | None = None) -> list[str]:
    """Return the user's watchlist tickers, oldest first."""
    if conn is not None:
        return _select_tickers(conn)
    with db_session() as owned:
        return _select_tickers(owned)


def _select_tickers(conn: sqlite3.Connection) -> list[str]:
    rows = conn.execute(
        "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY added_at, ticker",
        (DEFAULT_USER_ID,),
    ).fetchall()
    return [row["ticker"] for row in rows]


def list_watchlist(
    price_cache: PriceCache, conn: sqlite3.Connection | None = None
) -> list[WatchlistItem]:
    """Watchlist tickers joined with their latest prices from the cache."""
    if conn is not None:
        return _build_items(conn, price_cache)
    with db_session() as owned:
        return _build_items(owned, price_cache)


def _build_items(conn: sqlite3.Connection, price_cache: PriceCache) -> list[WatchlistItem]:
    rows = conn.execute(
        "SELECT ticker, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at, ticker",
        (DEFAULT_USER_ID,),
    ).fetchall()

    items: list[WatchlistItem] = []
    for row in rows:
        update = price_cache.get(row["ticker"])
        items.append(
            WatchlistItem(
                ticker=row["ticker"],
                added_at=row["added_at"],
                price=update.price if update else None,
                previous_price=update.previous_price if update else None,
                change=update.change if update else None,
                change_percent=update.change_percent if update else None,
                direction=update.direction if update else None,
                timestamp=update.timestamp if update else None,
            )
        )
    return items


def ensure_watchlist_row(conn: sqlite3.Connection, ticker: str) -> bool:
    """Insert a watchlist row for `ticker` if absent. True if it was added.

    Takes an existing connection so callers (notably trade execution) can include the
    insert in their own transaction.
    """
    cursor = conn.execute(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, utc_now_iso()),
    )
    return cursor.rowcount > 0


async def add_to_watchlist(
    ticker: str, price_cache: PriceCache, source: MarketDataSource
) -> list[WatchlistItem]:
    """Add a ticker to the watchlist and start tracking its price."""
    with db_session() as conn:
        added = ensure_watchlist_row(conn, ticker)
        items_conn = conn
        if added:
            logger.info("Watchlist: added %s", ticker)
        await source.add_ticker(ticker)
        return _build_items(items_conn, price_cache)


async def remove_from_watchlist(
    ticker: str, price_cache: PriceCache, source: MarketDataSource
) -> list[WatchlistItem]:
    """Remove a ticker from the watchlist and stop tracking its price.

    Raises KeyError if the ticker isn't on the watchlist.
    """
    with db_session() as conn:
        cursor = conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, ticker),
        )
        if cursor.rowcount == 0:
            raise KeyError(ticker)

        await source.remove_ticker(ticker)
        logger.info("Watchlist: removed %s", ticker)
        return _build_items(conn, price_cache)


# --- Routes ---


@router.get("", response_model=WatchlistResponse)
def get_watchlist(request: Request) -> WatchlistResponse:
    """Current watchlist tickers with their latest prices."""
    return WatchlistResponse(watchlist=list_watchlist(request.app.state.price_cache))


@router.post("", response_model=WatchlistMutationResponse, status_code=201)
async def post_watchlist(request: Request, body: WatchlistRequest) -> WatchlistMutationResponse:
    """Add a ticker to the watchlist."""
    items = await add_to_watchlist(
        body.ticker,
        request.app.state.price_cache,
        request.app.state.market_source,
    )
    return WatchlistMutationResponse(ticker=body.ticker, watchlist=items)


@router.delete("/{ticker}", response_model=WatchlistMutationResponse)
async def delete_watchlist(request: Request, ticker: str) -> WatchlistMutationResponse:
    """Remove a ticker from the watchlist."""
    symbol = ticker.strip().upper()
    try:
        items = await remove_from_watchlist(
            symbol,
            request.app.state.price_cache,
            request.app.state.market_source,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail=f"{symbol} is not on the watchlist") from None
    return WatchlistMutationResponse(ticker=symbol, watchlist=items)
