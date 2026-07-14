"""Tests for the chat endpoints: trade execution, error contract, history."""

from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from app.chat import build_portfolio_context, execute_trade, execute_watchlist_change
from app.llm import LLMError
from schema import DEFAULT_USER_ID, get_connection


def _conn(db_path: Path) -> sqlite3.Connection:
    return get_connection(db_path)


def _cash(db_path: Path) -> float:
    with _conn(db_path) as c:
        return c.execute(
            "SELECT cash_balance FROM users_profile WHERE id = ?", (DEFAULT_USER_ID,)
        ).fetchone()["cash_balance"]


def _position(db_path: Path, ticker: str):
    with _conn(db_path) as c:
        return c.execute(
            "SELECT quantity, avg_cost FROM positions WHERE user_id = ? AND ticker = ?",
            (DEFAULT_USER_ID, ticker),
        ).fetchone()


def _count(db_path: Path, table: str) -> int:
    with _conn(db_path) as c:
        return c.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]


class TestTradeExecution:
    def test_buy_updates_cash_position_trade_and_snapshot(self, db_path, price_cache):
        with _conn(db_path) as conn:
            result = execute_trade(conn, "AAPL", "buy", 10, price_cache)
            conn.commit()

        assert result["status"] == "executed"
        assert result["price"] == 190.0
        assert _cash(db_path) == pytest.approx(10000.0 - 1900.0)
        pos = _position(db_path, "AAPL")
        assert pos["quantity"] == 10
        assert pos["avg_cost"] == pytest.approx(190.0)
        assert _count(db_path, "trades") == 1
        assert _count(db_path, "portfolio_snapshots") == 1

    def test_buy_uses_weighted_average_cost(self, db_path, price_cache):
        with _conn(db_path) as conn:
            execute_trade(conn, "AAPL", "buy", 10, price_cache)
            conn.commit()
        price_cache.update("AAPL", 210.0)
        with _conn(db_path) as conn:
            execute_trade(conn, "AAPL", "buy", 10, price_cache)
            conn.commit()

        pos = _position(db_path, "AAPL")
        assert pos["quantity"] == 20
        assert pos["avg_cost"] == pytest.approx(200.0)

    def test_buy_auto_adds_ticker_to_watchlist(self, db_path, price_cache):
        price_cache.update("PYPL", 60.0)
        with _conn(db_path) as conn:
            conn.execute(
                "DELETE FROM watchlist WHERE ticker = ?",
                ("PYPL",),
            )
            conn.commit()
            execute_trade(conn, "PYPL", "buy", 1, price_cache)
            conn.commit()
            row = conn.execute(
                "SELECT 1 FROM watchlist WHERE user_id = ? AND ticker = ?",
                (DEFAULT_USER_ID, "PYPL"),
            ).fetchone()
        assert row is not None

    def test_buy_with_insufficient_cash_fails_cleanly(self, db_path, price_cache):
        with _conn(db_path) as conn:
            result = execute_trade(conn, "AAPL", "buy", 1000, price_cache)
            conn.commit()

        assert result["status"] == "failed"
        assert "insufficient cash" in result["error"]
        assert _cash(db_path) == 10000.0
        assert _count(db_path, "trades") == 0
        assert _position(db_path, "AAPL") is None

    def test_sell_reduces_position_and_adds_cash(self, db_path, price_cache):
        with _conn(db_path) as conn:
            execute_trade(conn, "AAPL", "buy", 10, price_cache)
            result = execute_trade(conn, "AAPL", "sell", 4, price_cache)
            conn.commit()

        assert result["status"] == "executed"
        assert _position(db_path, "AAPL")["quantity"] == pytest.approx(6)
        assert _cash(db_path) == pytest.approx(10000.0 - 1900.0 + 760.0)

    def test_full_sell_deletes_position(self, db_path, price_cache):
        with _conn(db_path) as conn:
            execute_trade(conn, "AAPL", "buy", 10, price_cache)
            execute_trade(conn, "AAPL", "sell", 10, price_cache)
            conn.commit()
        assert _position(db_path, "AAPL") is None
        assert _cash(db_path) == pytest.approx(10000.0)

    def test_sell_more_than_held_fails(self, db_path, price_cache):
        with _conn(db_path) as conn:
            execute_trade(conn, "AAPL", "buy", 2, price_cache)
            result = execute_trade(conn, "AAPL", "sell", 5, price_cache)
            conn.commit()
        assert result["status"] == "failed"
        assert "insufficient shares" in result["error"]
        assert _position(db_path, "AAPL")["quantity"] == 2

    def test_sell_with_no_position_fails(self, db_path, price_cache):
        with _conn(db_path) as conn:
            result = execute_trade(conn, "TSLA", "sell", 1, price_cache)
        assert result["status"] == "failed"

    @pytest.mark.parametrize(
        "ticker,side,qty,fragment",
        [
            ("AAPL", "hold", 1, "invalid side"),
            ("AAPL", "buy", 0, "greater than zero"),
            ("AAPL", "buy", -5, "greater than zero"),
            ("ZZZZ", "buy", 1, "no live price"),
        ],
    )
    def test_validation_failures(self, db_path, price_cache, ticker, side, qty, fragment):
        with _conn(db_path) as conn:
            result = execute_trade(conn, ticker, side, qty, price_cache)
        assert result["status"] == "failed"
        assert fragment in result["error"]

    def test_no_price_cache_means_no_trades(self, db_path):
        with _conn(db_path) as conn:
            result = execute_trade(conn, "AAPL", "buy", 1, None)
        assert result["status"] == "failed"


class TestWatchlistChanges:
    def test_add_and_remove(self, db_path):
        with _conn(db_path) as conn:
            assert execute_watchlist_change(conn, "pypl", "add")["status"] == "executed"
            conn.commit()
            assert execute_watchlist_change(conn, "PYPL", "remove")["status"] == "executed"
            conn.commit()
            assert (
                conn.execute(
                    "SELECT 1 FROM watchlist WHERE ticker = ?", ("PYPL",)
                ).fetchone()
                is None
            )

    def test_add_is_idempotent(self, db_path):
        with _conn(db_path) as conn:
            execute_watchlist_change(conn, "AAPL", "add")  # already seeded
            conn.commit()
            n = conn.execute(
                "SELECT COUNT(*) AS n FROM watchlist WHERE ticker = ?", ("AAPL",)
            ).fetchone()["n"]
        assert n == 1

    def test_remove_unknown_ticker_fails(self, db_path):
        with _conn(db_path) as conn:
            result = execute_watchlist_change(conn, "ZZZZ", "remove")
        assert result["status"] == "failed"

    def test_invalid_action(self, db_path):
        with _conn(db_path) as conn:
            assert execute_watchlist_change(conn, "AAPL", "toggle")["status"] == "failed"


class TestPortfolioContext:
    def test_fresh_portfolio(self, db_path, price_cache):
        with _conn(db_path) as conn:
            ctx = build_portfolio_context(conn, price_cache)
        assert ctx["cash_balance"] == 10000.0
        assert ctx["positions"] == []
        assert ctx["total_value"] == 10000.0
        assert len(ctx["watchlist"]) == 10
        assert {w["ticker"] for w in ctx["watchlist"]} >= {"AAPL", "TSLA"}

    def test_positions_carry_live_price_and_pnl(self, db_path, price_cache):
        with _conn(db_path) as conn:
            execute_trade(conn, "AAPL", "buy", 10, price_cache)
            conn.commit()
        price_cache.update("AAPL", 200.0)
        with _conn(db_path) as conn:
            ctx = build_portfolio_context(conn, price_cache)

        pos = ctx["positions"][0]
        assert pos["current_price"] == 200.0
        assert pos["unrealized_pnl"] == pytest.approx(100.0)
        assert pos["unrealized_pnl_percent"] == pytest.approx(5.263, rel=1e-3)
        assert ctx["total_value"] == pytest.approx(10000.0 - 1900.0 + 2000.0)


class TestPostChat:
    def test_generic_message_returns_response_and_persists_history(self, client, db_path):
        resp = client.post("/api/chat", json={"message": "how am I doing?"})
        assert resp.status_code == 200
        body = resp.json()
        assert "[MOCK]" in body["message"]
        assert body["trades"] == []
        assert _count(db_path, "chat_messages") == 2

    def test_mock_buy_executes_trade_end_to_end(self, client, db_path):
        resp = client.post("/api/chat", json={"message": "buy 10 AAPL please"})
        body = resp.json()
        assert resp.status_code == 200
        assert body["trades"][0]["status"] == "executed"
        assert body["trades"][0]["price"] == 190.0
        assert _cash(db_path) == pytest.approx(8100.0)
        assert _position(db_path, "AAPL")["quantity"] == 10

    def test_failed_trade_is_reported_in_message(self, client, db_path):
        resp = client.post("/api/chat", json={"message": "buy 1000 AAPL"})
        body = resp.json()
        assert resp.status_code == 200
        assert body["trades"][0]["status"] == "failed"
        assert "insufficient cash" in body["trades"][0]["error"]
        assert "could not be completed" in body["message"]
        assert _cash(db_path) == 10000.0
        # The exchange is still recorded (the LLM call itself succeeded).
        assert _count(db_path, "chat_messages") == 2

    def test_watchlist_change_executes(self, client, db_path):
        resp = client.post("/api/chat", json={"message": "add PYPL to my watchlist"})
        body = resp.json()
        assert body["watchlist_changes"][0] == {
            "ticker": "PYPL",
            "action": "add",
            "status": "executed",
            "error": None,
        }
        with _conn(db_path) as conn:
            assert conn.execute(
                "SELECT 1 FROM watchlist WHERE ticker = ?", ("PYPL",)
            ).fetchone()

    def test_actions_are_stored_on_the_assistant_row(self, client, db_path):
        client.post("/api/chat", json={"message": "buy 1 AAPL"})
        with _conn(db_path) as conn:
            rows = conn.execute(
                "SELECT role, actions FROM chat_messages ORDER BY rowid"
            ).fetchall()
        assert rows[0]["role"] == "user"
        assert rows[0]["actions"] is None
        assert rows[1]["role"] == "assistant"
        assert '"executed"' in rows[1]["actions"]

    def test_empty_message_rejected(self, client):
        assert client.post("/api/chat", json={"message": ""}).status_code == 422


class TestErrorContract:
    def test_llm_failure_returns_502_error_body_and_writes_no_row(
        self, client, db_path, monkeypatch
    ):
        def boom(*args, **kwargs):
            raise LLMError("LLM request failed: connection reset")

        monkeypatch.setattr("app.chat.call_llm", boom)

        resp = client.post("/api/chat", json={"message": "hello"})
        assert resp.status_code == 502
        assert resp.json() == {"error": "LLM request failed: connection reset"}
        assert "detail" not in resp.json()
        assert _count(db_path, "chat_messages") == 0


class TestGetChat:
    def test_empty_history(self, client):
        resp = client.get("/api/chat")
        assert resp.status_code == 200
        assert resp.json() == {"messages": []}

    def test_history_is_oldest_first_with_parsed_actions(self, client):
        client.post("/api/chat", json={"message": "first question"})
        client.post("/api/chat", json={"message": "buy 1 AAPL"})

        messages = client.get("/api/chat").json()["messages"]
        assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
        assert messages[0]["content"] == "first question"
        assert messages[2]["content"] == "buy 1 AAPL"
        assert messages[3]["actions"]["trades"][0]["ticker"] == "AAPL"
        assert messages[0]["actions"] is None

    def test_limit_returns_most_recent(self, client):
        for i in range(3):
            client.post("/api/chat", json={"message": f"message {i}"})
        messages = client.get("/api/chat", params={"limit": 2}).json()["messages"]
        assert len(messages) == 2
        assert messages[0]["content"] == "message 2"
        assert messages[0]["role"] == "user"
