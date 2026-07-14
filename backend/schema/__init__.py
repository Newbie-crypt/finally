"""FinAlly database schema, seed data, and lazy initialization.

Public API:
    get_connection(db_path=None) -> sqlite3.Connection   Open a connection (lazily inits DB)
    db_session(db_path=None)                             Context manager: commit/rollback/close
    init_db(db_path=None, *, force=False) -> Path        Create schema + seed (idempotent)
    get_db_path() -> Path                                Resolve the SQLite file path
    seed_database(conn) -> bool                          Insert defaults; True if DB was fresh
    utc_now_iso() -> str                                 ISO-8601 UTC timestamp (DB format)

The database path comes from the ``FINALLY_DB_PATH`` env var when set (the Dockerfile
sets it to ``/app/db/finally.db``), otherwise ``<project-root>/db/finally.db``.

Constants:
    DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, DEFAULT_WATCHLIST, TABLE_NAMES,
    DEFAULT_DB_PATH, DB_PATH_ENV_VAR
"""

from .database import (
    DB_PATH_ENV_VAR,
    DEFAULT_DB_PATH,
    TABLE_NAMES,
    db_session,
    get_connection,
    get_db_path,
    init_db,
    reset_init_cache,
)
from .seed import (
    DEFAULT_CASH_BALANCE,
    DEFAULT_USER_ID,
    DEFAULT_WATCHLIST,
    seed_database,
    utc_now_iso,
)

__all__ = [
    "get_connection",
    "db_session",
    "init_db",
    "get_db_path",
    "seed_database",
    "utc_now_iso",
    "reset_init_cache",
    "DB_PATH_ENV_VAR",
    "DEFAULT_DB_PATH",
    "DEFAULT_USER_ID",
    "DEFAULT_CASH_BALANCE",
    "DEFAULT_WATCHLIST",
    "TABLE_NAMES",
]
