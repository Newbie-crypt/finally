"""Portfolio endpoints, trade execution, and the periodic snapshot task (PLAN.md §7, §8).

The service functions here (`build_portfolio`, `execute_trade`, `record_snapshot`) are the
reusable core — the router is a thin shell over them, so the chat/LLM layer can execute
trades and read portfolio context through the same validated code path.
"""

from __future__ import annotations

import asyncio
import logging
import sqlite3
import uuid

from fastapi import APIRouter, HTTPException, Request

from app.market import MarketDataSource, PriceCache
from app.models import (
    HistoryResponse,
    Portfolio,
    Position,
    Snapshot,
    Trade,
    TradeRequest,
    TradeResponse,
)
from app.watchlist import ensure_watchlist_row
from schema import DEFAULT_USER_ID, db_session, utc_now_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portfolio", tags=["portfolio"])

SNAPSHOT_INTERVAL_SECONDS = 30.0

# Guards against float dust (e.g. 1e-13 shares) lingering as a phantom position,
# and against a buy failing validation by a fraction of a cent.
QUANTITY_EPSILON = 1e-9
CASH_EPSILON = 1e-6


class TradeError(ValueError):
    """A trade failed validation (insufficient cash/shares, or no price available).

    Carries an HTTP status so the router can map it directly; the chat layer can just
    use `str(err)` as the message it reports back to the LLM/user.
    """

    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


# --- Services (usable without HTTP) ---


def build_portfolio(price_cache: PriceCache, conn: sqlite3.Connection | None = None) -> Portfolio:
    """Cash, positions valued at the latest cached prices, total value, and unrealized P&L."""
    if conn is not None:
        return _build_portfolio(conn, price_cache)
    with db_session() as owned:
        return _build_portfolio(owned, price_cache)


def _build_portfolio(conn: sqlite3.Connection, price_cache: PriceCache) -> Portfolio:
    cash = _get_cash_balance(conn)

    rows = conn.execute(
        "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ? ORDER BY ticker",
        (DEFAULT_USER_ID,),
    ).fetchall()

    positions: list[Position] = []
    positions_value = 0.0
    total_pnl = 0.0

    for row in rows:
        quantity = row["quantity"]
        avg_cost = row["avg_cost"]
        # An uncached ticker (e.g. Massive hasn't polled it yet) is valued at cost, so the
        # portfolio total stays sane rather than dropping the position's value to zero.
        current_price = price_cache.get_price(row["ticker"])
        valuation_price = current_price if current_price is not None else avg_cost

        cost_basis = quantity * avg_cost
        market_value = quantity * valuation_price
        pnl = market_value - cost_basis
        pnl_percent = (pnl / cost_basis * 100) if cost_basis else 0.0

        positions_value += market_value
        total_pnl += pnl

        positions.append(
            Position(
                ticker=row["ticker"],
                quantity=quantity,
                avg_cost=round(avg_cost, 4),
                current_price=current_price,
                market_value=round(market_value, 2),
                cost_basis=round(cost_basis, 2),
                unrealized_pnl=round(pnl, 2),
                unrealized_pnl_percent=round(pnl_percent, 2),
            )
        )

    return Portfolio(
        cash_balance=round(cash, 2),
        positions=positions,
        positions_value=round(positions_value, 2),
        total_value=round(cash + positions_value, 2),
        total_unrealized_pnl=round(total_pnl, 2),
    )


def _get_cash_balance(conn: sqlite3.Connection) -> float:
    row = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    ).fetchone()
    return row["cash_balance"] if row else 0.0


def record_snapshot(total_value: float, conn: sqlite3.Connection | None = None) -> Snapshot:
    """Append a row to `portfolio_snapshots` (the P&L chart's data source)."""
    if conn is not None:
        return _insert_snapshot(conn, total_value)
    with db_session() as owned:
        return _insert_snapshot(owned, total_value)


def _insert_snapshot(conn: sqlite3.Connection, total_value: float) -> Snapshot:
    snapshot = Snapshot(
        id=str(uuid.uuid4()),
        total_value=round(total_value, 2),
        recorded_at=utc_now_iso(),
    )
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) VALUES (?, ?, ?, ?)",
        (snapshot.id, DEFAULT_USER_ID, snapshot.total_value, snapshot.recorded_at),
    )
    return snapshot


def get_history(conn: sqlite3.Connection | None = None) -> list[Snapshot]:
    """All portfolio value snapshots, oldest first."""
    if conn is not None:
        return _select_history(conn)
    with db_session() as owned:
        return _select_history(owned)


def _select_history(conn: sqlite3.Connection) -> list[Snapshot]:
    rows = conn.execute(
        "SELECT id, total_value, recorded_at FROM portfolio_snapshots "
        "WHERE user_id = ? ORDER BY recorded_at, id",
        (DEFAULT_USER_ID,),
    ).fetchall()
    return [
        Snapshot(id=row["id"], total_value=row["total_value"], recorded_at=row["recorded_at"])
        for row in rows
    ]


async def resolve_price(
    ticker: str, price_cache: PriceCache, source: MarketDataSource
) -> float:
    """Latest price for `ticker`, adding it to the market data source if it's unknown.

    The simulator seeds a price for a new ticker immediately; the Massive source only
    picks it up on its next poll, so a brand-new ticker may briefly have no price.
    """
    price = price_cache.get_price(ticker)
    if price is not None:
        return price

    await source.add_ticker(ticker)
    price = price_cache.get_price(ticker)
    if price is None:
        raise TradeError(
            f"No price available for {ticker} yet — it is now being tracked, try again shortly.",
            status_code=503,
        )
    return price


async def execute_trade(
    ticker: str,
    side: str,
    quantity: float,
    price_cache: PriceCache,
    source: MarketDataSource,
) -> tuple[Trade, Portfolio]:
    """Execute a market order at the current price. Raises TradeError on invalid orders.

    On success (one transaction): position upserted (weighted-average cost on buy, reduced
    or deleted on sell), cash updated, `trades` row appended, a fresh `portfolio_snapshots`
    row written, and the ticker auto-added to the watchlist (PLAN.md §8).
    """
    if quantity <= 0:
        raise TradeError("Quantity must be greater than zero.")

    price = await resolve_price(ticker, price_cache, source)
    added_to_watchlist = False

    with db_session() as conn:
        cash = _get_cash_balance(conn)
        position = conn.execute(
            "SELECT id, quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, ticker),
        ).fetchone()

        held = position["quantity"] if position else 0.0
        proceeds = quantity * price
        now = utc_now_iso()

        if side == "buy":
            if proceeds > cash + CASH_EPSILON:
                raise TradeError(
                    f"Insufficient cash: {quantity:g} {ticker} @ ${price:,.2f} costs "
                    f"${proceeds:,.2f} but only ${cash:,.2f} is available."
                )
            new_cash = cash - proceeds

            if position:
                new_quantity = held + quantity
                new_avg_cost = (held * position["avg_cost"] + proceeds) / new_quantity
                conn.execute(
                    "UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = ? WHERE id = ?",
                    (new_quantity, new_avg_cost, now, position["id"]),
                )
            else:
                conn.execute(
                    "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, quantity, price, now),
                )
        else:  # sell
            if quantity > held + QUANTITY_EPSILON:
                raise TradeError(
                    f"Insufficient shares: cannot sell {quantity:g} {ticker}, "
                    f"only {held:g} held."
                )
            new_cash = cash + proceeds
            remaining = held - quantity

            if remaining <= QUANTITY_EPSILON:
                conn.execute("DELETE FROM positions WHERE id = ?", (position["id"],))
            else:
                conn.execute(
                    "UPDATE positions SET quantity = ?, updated_at = ? WHERE id = ?",
                    (remaining, now, position["id"]),
                )

        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (new_cash, DEFAULT_USER_ID),
        )

        trade = Trade(
            id=str(uuid.uuid4()),
            ticker=ticker,
            side=side,  # type: ignore[arg-type]
            quantity=quantity,
            price=price,
            executed_at=now,
        )
        conn.execute(
            "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (trade.id, DEFAULT_USER_ID, ticker, side, quantity, price, now),
        )

        added_to_watchlist = ensure_watchlist_row(conn, ticker)

        portfolio = _build_portfolio(conn, price_cache)
        _insert_snapshot(conn, portfolio.total_value)

    if added_to_watchlist:
        await source.add_ticker(ticker)

    logger.info("Trade executed: %s %g %s @ %.2f", side, quantity, ticker, price)
    return trade, portfolio


async def snapshot_loop(
    price_cache: PriceCache, interval: float = SNAPSHOT_INTERVAL_SECONDS
) -> None:
    """Background task: record the portfolio's total value every `interval` seconds."""
    while True:
        await asyncio.sleep(interval)
        try:
            portfolio = await asyncio.to_thread(build_portfolio, price_cache)
            await asyncio.to_thread(record_snapshot, portfolio.total_value)
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Periodic portfolio snapshot failed")


# --- Routes ---


@router.get("", response_model=Portfolio)
def get_portfolio(request: Request) -> Portfolio:
    """Positions, cash, total value, and unrealized P&L."""
    return build_portfolio(request.app.state.price_cache)


@router.post("/trade", response_model=TradeResponse)
async def post_trade(request: Request, body: TradeRequest) -> TradeResponse:
    """Execute a market order — instant fill at the current price, no fees."""
    try:
        trade, portfolio = await execute_trade(
            body.ticker,
            body.side,
            body.quantity,
            request.app.state.price_cache,
            request.app.state.market_source,
        )
    except TradeError as err:
        raise HTTPException(status_code=err.status_code, detail=str(err)) from err
    return TradeResponse(trade=trade, portfolio=portfolio)


@router.get("/history", response_model=HistoryResponse)
def get_portfolio_history() -> HistoryResponse:
    """Portfolio value snapshots over time (for the P&L chart)."""
    return HistoryResponse(snapshots=get_history())
