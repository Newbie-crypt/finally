"""Tests for default seed data."""

import sqlite3
from datetime import datetime

import pytest

from schema import (
    DEFAULT_CASH_BALANCE,
    DEFAULT_USER_ID,
    DEFAULT_WATCHLIST,
    get_connection,
    init_db,
    reset_init_cache,
    seed_database,
    utc_now_iso,
)


@pytest.fixture(autouse=True)
def clean_init_cache():
    reset_init_cache()
    yield
    reset_init_cache()


@pytest.fixture
def conn(tmp_path):
    connection = get_connection(tmp_path / "seed.db")
    yield connection
    connection.close()


class TestSeedData:
    """A fresh database is seeded per PLAN.md §7."""

    def test_default_user_profile(self, conn):
        rows = conn.execute("SELECT * FROM users_profile").fetchall()
        assert len(rows) == 1
        assert rows[0]["id"] == DEFAULT_USER_ID == "default"
        assert rows[0]["cash_balance"] == DEFAULT_CASH_BALANCE == 10000.0
        # created_at is a parseable ISO timestamp
        datetime.fromisoformat(rows[0]["created_at"])

    def test_default_watchlist(self, conn):
        rows = conn.execute("SELECT ticker, user_id, id FROM watchlist ORDER BY ticker").fetchall()
        tickers = [row["ticker"] for row in rows]
        assert tickers == sorted(DEFAULT_WATCHLIST)
        assert set(DEFAULT_WATCHLIST) == {
            "AAPL", "GOOGL", "MSFT", "AMZN", "TSLA", "NVDA", "META", "JPM", "V", "NFLX",
        }
        assert all(row["user_id"] == "default" for row in rows)
        # Each row has a distinct UUID primary key
        assert len({row["id"] for row in rows}) == 10

    def test_other_tables_start_empty(self, conn):
        for table in ("positions", "trades", "portfolio_snapshots", "chat_messages"):
            n = conn.execute(f"SELECT COUNT(*) AS n FROM {table}").fetchone()["n"]
            assert n == 0, table


class TestSeedIdempotency:
    """Seeding runs once; it never duplicates or resurrects data."""

    def test_seed_returns_true_only_on_fresh_db(self, tmp_path):
        path = tmp_path / "fresh.db"
        init_db(path)  # already seeds
        conn = sqlite3.connect(path)
        conn.row_factory = sqlite3.Row
        try:
            assert seed_database(conn) is False  # second call: not fresh
        finally:
            conn.close()

    def test_repeated_seed_does_not_duplicate(self, conn):
        for _ in range(3):
            seed_database(conn)
        assert conn.execute("SELECT COUNT(*) AS n FROM users_profile").fetchone()["n"] == 1
        assert conn.execute("SELECT COUNT(*) AS n FROM watchlist").fetchone()["n"] == 10

    def test_removed_ticker_is_not_reseeded(self, conn):
        """A user who removes a default ticker doesn't get it back on restart."""
        conn.execute("DELETE FROM watchlist WHERE ticker = 'TSLA'")
        conn.commit()

        seed_database(conn)  # simulates a restart

        tickers = {
            row["ticker"] for row in conn.execute("SELECT ticker FROM watchlist").fetchall()
        }
        assert "TSLA" not in tickers
        assert len(tickers) == 9

    def test_cash_balance_preserved_across_seed(self, conn):
        conn.execute("UPDATE users_profile SET cash_balance = 555.5 WHERE id = 'default'")
        conn.commit()

        seed_database(conn)

        cash = conn.execute("SELECT cash_balance FROM users_profile").fetchone()["cash_balance"]
        assert cash == 555.5


class TestTimestamps:
    def test_utc_now_iso_is_parseable_and_tz_aware(self):
        ts = utc_now_iso()
        parsed = datetime.fromisoformat(ts)
        assert parsed.tzinfo is not None
        assert parsed.utcoffset().total_seconds() == 0
