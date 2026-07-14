"""SQLite connection management and lazy database initialization.

The database lives at ``<project-root>/db/finally.db`` — the directory that Docker
mounts as a volume (planning/PLAN.md §4, §11).

Path resolution, in order:

1. ``FINALLY_DB_PATH`` if set and non-empty. The Dockerfile sets this to
   ``/app/db/finally.db``; tests use it to redirect to a tmp dir.
2. Otherwise a path derived from this module's own file location — never from the
   process working directory, so it resolves identically under ``uv run`` from
   ``backend/`` or under uvicorn inside the container.

Initialization is lazy and idempotent: the first connection to a given path
creates the schema and seeds default data if needed; subsequent connections skip
straight through.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from threading import Lock

from .seed import seed_database

DB_PATH_ENV_VAR = "FINALLY_DB_PATH"

_MODULE_DIR = Path(__file__).resolve().parent  # .../schema


def _default_db_path() -> Path:
    """Locate ``db/finally.db`` relative to this module, for both supported layouts.

    Dev checkout: this file is ``<project-root>/backend/schema/database.py``, so the
    project root is two levels up and the database belongs in ``<project-root>/db/``.

    Docker image: the Dockerfile copies ``backend/app/`` and ``backend/schema/`` in as
    top-level siblings under ``/app``, so ``backend/`` is gone and the database belongs
    in ``/app/db/`` (the volume mount). Two levels up would be ``/`` — the container
    normally sets FINALLY_DB_PATH, but this keeps the fallback from pointing at the
    root filesystem if that env var is ever dropped.
    """
    dev_root = _MODULE_DIR.parents[1]
    if (dev_root / "backend" / "schema" / "database.py").is_file():
        return dev_root / "db" / "finally.db"
    return _MODULE_DIR.parent / "db" / "finally.db"


DEFAULT_DB_PATH = _default_db_path()
PROJECT_ROOT = DEFAULT_DB_PATH.parent.parent

SCHEMA_SQL_PATH = _MODULE_DIR / "tables.sql"

TABLE_NAMES: tuple[str, ...] = (
    "users_profile",
    "watchlist",
    "positions",
    "trades",
    "portfolio_snapshots",
    "chat_messages",
)

_init_lock = Lock()
_initialized: set[Path] = set()


def get_db_path() -> Path:
    """Resolve the SQLite file path.

    Honours the ``FINALLY_DB_PATH`` environment variable if set and non-empty
    (relative values are resolved against the current working directory);
    otherwise returns ``<project-root>/db/finally.db``.
    """
    override = os.environ.get(DB_PATH_ENV_VAR, "").strip()
    if override:
        return Path(override).expanduser().resolve()
    return DEFAULT_DB_PATH


def _apply_pragmas(conn: sqlite3.Connection) -> None:
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")


def init_db(db_path: Path | str | None = None, *, force: bool = False) -> Path:
    """Create the schema and seed default data if needed. Idempotent.

    Safe to call on every application startup. Creates the parent directory if
    missing, executes ``tables.sql`` (all statements are ``IF NOT EXISTS``), then
    seeds the default user profile and watchlist only when the database is fresh.

    Args:
        db_path: Target database file. Defaults to :func:`get_db_path`.
        force: Re-run schema + seed even if this path was already initialized in
            this process (used by tests that recreate a database file).

    Returns:
        The resolved path to the initialized database file.
    """
    path = Path(db_path).expanduser().resolve() if db_path else get_db_path()

    with _init_lock:
        if path in _initialized and not force and path.exists():
            return path

        path.parent.mkdir(parents=True, exist_ok=True)
        sql = SCHEMA_SQL_PATH.read_text(encoding="utf-8")

        conn = sqlite3.connect(path)
        try:
            _apply_pragmas(conn)
            conn.executescript(sql)
            conn.commit()
            seed_database(conn)
        finally:
            conn.close()

        _initialized.add(path)
        return path


def get_connection(db_path: Path | str | None = None) -> sqlite3.Connection:
    """Open a new SQLite connection, initializing the database on first use.

    The caller owns the connection and must close it (or use :func:`db_session`,
    which handles commit/rollback/close). Rows come back as ``sqlite3.Row``, so
    they support both index and column-name access.
    """
    path = Path(db_path).expanduser().resolve() if db_path else get_db_path()
    init_db(path)

    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    _apply_pragmas(conn)
    return conn


@contextmanager
def db_session(db_path: Path | str | None = None) -> Iterator[sqlite3.Connection]:
    """Context manager yielding a connection: commits on success, rolls back on error.

    Usage::

        with db_session() as conn:
            conn.execute("UPDATE users_profile SET cash_balance = ? WHERE id = ?", (500.0, "default"))
    """
    conn = get_connection(db_path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def reset_init_cache() -> None:
    """Clear the in-process 'already initialized' cache. For tests only."""
    with _init_lock:
        _initialized.clear()
