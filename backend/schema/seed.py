"""Default seed data for a fresh FinAlly database (see planning/PLAN.md §7)."""

from __future__ import annotations

import sqlite3
import uuid
from datetime import UTC, datetime

DEFAULT_USER_ID = "default"
DEFAULT_CASH_BALANCE = 10000.0

DEFAULT_WATCHLIST: tuple[str, ...] = (
    "AAPL",
    "GOOGL",
    "MSFT",
    "AMZN",
    "TSLA",
    "NVDA",
    "META",
    "JPM",
    "V",
    "NFLX",
)


def utc_now_iso() -> str:
    """Current UTC time as an ISO-8601 string. All timestamps in the DB use this format."""
    return datetime.now(UTC).isoformat()


def seed_database(conn: sqlite3.Connection) -> bool:
    """Insert default seed data if it is not already present.

    Idempotent: existing rows are left untouched (INSERT OR IGNORE relies on the
    users_profile primary key and the watchlist (user_id, ticker) UNIQUE constraint),
    so an already-seeded database is never modified — a user who sold everything and
    cleared their watchlist will not have it silently repopulated on the next restart.

    Returns True if this call inserted the default user profile (i.e. the database
    was fresh), False if it was already seeded.
    """
    now = utc_now_iso()

    cursor = conn.execute(
        "INSERT OR IGNORE INTO users_profile (id, cash_balance, created_at) VALUES (?, ?, ?)",
        (DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, now),
    )
    is_fresh = cursor.rowcount > 0

    # Only seed the watchlist alongside a fresh profile; otherwise a user who
    # removed default tickers would see them reappear on every startup.
    if is_fresh:
        conn.executemany(
            "INSERT OR IGNORE INTO watchlist (id, user_id, ticker, added_at) VALUES (?, ?, ?, ?)",
            [
                (str(uuid.uuid4()), DEFAULT_USER_ID, ticker, now)
                for ticker in DEFAULT_WATCHLIST
            ],
        )

    conn.commit()
    return is_fresh
