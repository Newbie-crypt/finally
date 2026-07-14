"""Chat endpoints for the FinAlly AI assistant (planning/PLAN.md §8, §9).

Mount into the app with::

    from app.chat import router as chat_router
    app.include_router(chat_router)

Endpoints:
    POST /api/chat  -> {message} -> LLM structured response, actions auto-executed
    GET  /api/chat  -> recent conversation history (for repopulating the panel on load)

The router reads the running :class:`~app.market.PriceCache` from
``request.app.state.price_cache`` and an optional DB path override from
``request.app.state.db_path`` (tests use the latter; production leaves it unset so the
``schema`` module resolves the default path).

Trade execution here is deliberately self-contained (it writes ``positions``, ``trades``,
``portfolio_snapshots``, ``watchlist``, and ``users_profile.cash_balance`` directly) so the
chat flow has no import dependency on the manual-trade endpoint.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import uuid
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.llm import ChatCompletionResponse, LLMError, call_llm
from app.market import PriceCache
from schema import DEFAULT_USER_ID, db_session, utc_now_iso

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["chat"])

HISTORY_LIMIT = 20
MAX_HISTORY_LIMIT = 200
EPSILON = 1e-9  # float slack for cash/share comparisons


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


# --------------------------------------------------------------------------------------
# Portfolio context
# --------------------------------------------------------------------------------------


def _price_of(price_cache: PriceCache | None, ticker: str) -> float | None:
    return price_cache.get_price(ticker) if price_cache else None


def build_portfolio_context(
    conn: sqlite3.Connection, price_cache: PriceCache | None
) -> dict[str, Any]:
    """Cash, positions (with live price + unrealized P&L), watchlist, and total value."""
    row = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    ).fetchone()
    cash = float(row["cash_balance"]) if row else 0.0

    positions: list[dict[str, Any]] = []
    positions_value = 0.0
    total_pnl = 0.0
    for p in conn.execute(
        "SELECT ticker, quantity, avg_cost FROM positions WHERE user_id = ? ORDER BY ticker",
        (DEFAULT_USER_ID,),
    ).fetchall():
        ticker = p["ticker"]
        qty = float(p["quantity"])
        avg_cost = float(p["avg_cost"])
        price = _price_of(price_cache, ticker)
        mark = price if price is not None else avg_cost  # unpriced ticker -> value at cost
        market_value = qty * mark
        pnl = (mark - avg_cost) * qty
        positions_value += market_value
        total_pnl += pnl
        positions.append(
            {
                "ticker": ticker,
                "quantity": qty,
                "avg_cost": avg_cost,
                "current_price": price,
                "market_value": market_value,
                "unrealized_pnl": pnl,
                "unrealized_pnl_percent": ((mark / avg_cost - 1) * 100) if avg_cost else 0.0,
            }
        )

    watchlist = [
        {"ticker": w["ticker"], "price": _price_of(price_cache, w["ticker"])}
        for w in conn.execute(
            "SELECT ticker FROM watchlist WHERE user_id = ? ORDER BY ticker",
            (DEFAULT_USER_ID,),
        ).fetchall()
    ]

    return {
        "cash_balance": cash,
        "positions": positions,
        "positions_value": positions_value,
        "total_value": cash + positions_value,
        "total_unrealized_pnl": total_pnl,
        "watchlist": watchlist,
    }


def _total_value(conn: sqlite3.Connection, price_cache: PriceCache | None) -> float:
    ctx = build_portfolio_context(conn, price_cache)
    return float(ctx["total_value"])


def _record_snapshot(conn: sqlite3.Connection, price_cache: PriceCache | None) -> None:
    conn.execute(
        "INSERT INTO portfolio_snapshots (id, user_id, total_value, recorded_at) "
        "VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, _total_value(conn, price_cache), utc_now_iso()),
    )


def _add_to_watchlist(conn: sqlite3.Connection, ticker: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, utc_now_iso()),
    )


# --------------------------------------------------------------------------------------
# Trade + watchlist execution
# --------------------------------------------------------------------------------------


def execute_trade(
    conn: sqlite3.Connection,
    ticker: str,
    side: str,
    quantity: float,
    price_cache: PriceCache | None,
) -> dict[str, Any]:
    """Execute one market order. Same validation as the manual trade endpoint.

    Returns a result dict: ``{ticker, side, quantity, price, status, error}`` where
    ``status`` is ``"executed"`` or ``"failed"``. Never raises on validation failure —
    the caller surfaces the error back to the user (PLAN.md §9).
    """
    ticker = ticker.strip().upper()
    side = side.strip().lower()
    result: dict[str, Any] = {
        "ticker": ticker,
        "side": side,
        "quantity": quantity,
        "price": None,
        "status": "failed",
        "error": None,
    }

    if side not in ("buy", "sell"):
        result["error"] = f"invalid side '{side}'"
        return result
    if not ticker:
        result["error"] = "missing ticker"
        return result
    if quantity is None or quantity <= 0:
        result["error"] = "quantity must be greater than zero"
        return result

    price = _price_of(price_cache, ticker)
    if price is None or price <= 0:
        result["error"] = f"no live price available for {ticker}"
        return result
    result["price"] = price

    pos = conn.execute(
        "SELECT id, quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
        (DEFAULT_USER_ID, ticker),
    ).fetchone()
    cash_row = conn.execute(
        "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
    ).fetchone()
    cash = float(cash_row["cash_balance"]) if cash_row else 0.0
    now = utc_now_iso()

    if side == "buy":
        cost = price * quantity
        if cost > cash + EPSILON:
            result["error"] = (
                f"insufficient cash: {ticker} buy of {quantity:g} shares costs "
                f"${cost:,.2f} but only ${cash:,.2f} is available"
            )
            return result

        if pos:
            old_qty = float(pos["quantity"])
            old_avg = float(pos["avg_cost"])
            new_qty = old_qty + quantity
            new_avg = (old_qty * old_avg + quantity * price) / new_qty
            conn.execute(
                "UPDATE positions SET quantity = ?, avg_cost = ?, updated_at = ? WHERE id = ?",
                (new_qty, new_avg, now, pos["id"]),
            )
        else:
            conn.execute(
                "INSERT INTO positions (id, user_id, ticker, quantity, avg_cost, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, quantity, price, now),
            )
        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (cash - cost, DEFAULT_USER_ID),
        )
        _add_to_watchlist(conn, ticker)  # PLAN.md §8: a traded ticker joins the watchlist

    else:  # sell
        held = float(pos["quantity"]) if pos else 0.0
        if quantity > held + EPSILON:
            result["error"] = (
                f"insufficient shares: cannot sell {quantity:g} {ticker}, only {held:g} held"
            )
            return result

        remaining = held - quantity
        if remaining <= EPSILON:
            conn.execute("DELETE FROM positions WHERE id = ?", (pos["id"],))
        else:
            conn.execute(
                "UPDATE positions SET quantity = ?, updated_at = ? WHERE id = ?",
                (remaining, now, pos["id"]),
            )
        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?",
            (cash + price * quantity, DEFAULT_USER_ID),
        )

    conn.execute(
        "INSERT INTO trades (id, user_id, ticker, side, quantity, price, executed_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, side, quantity, price, now),
    )
    _record_snapshot(conn, price_cache)

    result["status"] = "executed"
    return result


def execute_watchlist_change(
    conn: sqlite3.Connection, ticker: str, action: str
) -> dict[str, Any]:
    """Add or remove a watchlist ticker. Returns a result dict like :func:`execute_trade`."""
    ticker = ticker.strip().upper()
    action = action.strip().lower()
    result: dict[str, Any] = {
        "ticker": ticker,
        "action": action,
        "status": "failed",
        "error": None,
    }

    if not ticker:
        result["error"] = "missing ticker"
        return result

    if action == "add":
        _add_to_watchlist(conn, ticker)
        result["status"] = "executed"
    elif action == "remove":
        cur = conn.execute(
            "DELETE FROM watchlist WHERE user_id = ? AND ticker = ?", (DEFAULT_USER_ID, ticker)
        )
        if cur.rowcount == 0:
            result["error"] = f"{ticker} is not on the watchlist"
        else:
            result["status"] = "executed"
    else:
        result["error"] = f"invalid action '{action}'"

    return result


def apply_actions(
    conn: sqlite3.Connection,
    llm_response: ChatCompletionResponse,
    price_cache: PriceCache | None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Auto-execute the LLM's trades and watchlist changes; return both result lists."""
    trades = [
        execute_trade(conn, t.ticker, t.side, t.quantity, price_cache)
        for t in llm_response.trades
    ]
    changes = [
        execute_watchlist_change(conn, c.ticker, c.action)
        for c in llm_response.watchlist_changes
    ]
    return trades, changes


def compose_message(
    base_message: str,
    trade_results: list[dict[str, Any]],
    watchlist_results: list[dict[str, Any]],
) -> str:
    """Append a note about any failed actions so the user sees why they didn't happen.

    PLAN.md §9: "If a trade fails validation ... the error is included in the chat response."
    """
    failures = [r for r in trade_results + watchlist_results if r["status"] == "failed"]
    if not failures:
        return base_message

    lines = [base_message, "", "Note — some actions could not be completed:"]
    for f in failures:
        label = (
            f"{f['side']} {f['quantity']:g} {f['ticker']}"
            if "side" in f
            else f"{f['action']} {f['ticker']}"
        )
        lines.append(f"- {label}: {f['error']}")
    return "\n".join(lines)


# --------------------------------------------------------------------------------------
# Persistence
# --------------------------------------------------------------------------------------


def _insert_message(
    conn: sqlite3.Connection, role: str, content: str, actions: dict[str, Any] | None
) -> dict[str, Any]:
    row = {
        "id": str(uuid.uuid4()),
        "user_id": DEFAULT_USER_ID,
        "role": role,
        "content": content,
        "actions": json.dumps(actions) if actions else None,
        "created_at": utc_now_iso(),
    }
    conn.execute(
        "INSERT INTO chat_messages (id, user_id, role, content, actions, created_at) "
        "VALUES (:id, :user_id, :role, :content, :actions, :created_at)",
        row,
    )
    return row


def load_history(conn: sqlite3.Connection, limit: int = HISTORY_LIMIT) -> list[dict[str, Any]]:
    """Most recent ``limit`` chat messages, oldest-first."""
    rows = conn.execute(
        "SELECT id, role, content, actions, created_at FROM chat_messages "
        "WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
        (DEFAULT_USER_ID, limit),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "role": r["role"],
            "content": r["content"],
            "actions": json.loads(r["actions"]) if r["actions"] else None,
            "created_at": r["created_at"],
        }
        for r in reversed(rows)
    ]


# --------------------------------------------------------------------------------------
# Routes
# --------------------------------------------------------------------------------------


def _app_state(request: Request) -> tuple[PriceCache | None, Any]:
    state = request.app.state
    return getattr(state, "price_cache", None), getattr(state, "db_path", None)


@router.post("/chat")
async def post_chat(request: Request, body: ChatRequest) -> JSONResponse:
    """Send a message to FinAlly; auto-execute any actions it returns."""
    price_cache, db_path = _app_state(request)
    user_message = body.message.strip()

    # 1-3. Portfolio context + conversation history -> prompt.
    with db_session(db_path) as conn:
        context = build_portfolio_context(conn, price_cache)
        history = load_history(conn)

    # 4. LLM call. On failure: HTTP 502 + {"error": ...}, and no chat_messages row.
    try:
        llm_response = call_llm(user_message, context, history)
    except LLMError as exc:
        logger.warning("Chat LLM failure: %s", exc)
        return JSONResponse(status_code=502, content={"error": str(exc)})

    # 5-7. Execute actions, persist both messages.
    with db_session(db_path) as conn:
        trade_results, watchlist_results = apply_actions(conn, llm_response, price_cache)
        message = compose_message(llm_response.message, trade_results, watchlist_results)
        actions = {"trades": trade_results, "watchlist_changes": watchlist_results}

        _insert_message(conn, "user", user_message, None)
        assistant_row = _insert_message(conn, "assistant", message, actions)

    # 8. Complete structured response.
    return JSONResponse(
        content={
            "id": assistant_row["id"],
            "message": message,
            "trades": trade_results,
            "watchlist_changes": watchlist_results,
            "created_at": assistant_row["created_at"],
        }
    )


@router.get("/chat")
async def get_chat(request: Request, limit: int = HISTORY_LIMIT) -> dict[str, Any]:
    """Recent conversation history, oldest-first, so the frontend can repopulate the panel."""
    _, db_path = _app_state(request)
    limit = max(1, min(limit, MAX_HISTORY_LIMIT))
    with db_session(db_path) as conn:
        return {"messages": load_history(conn, limit)}
