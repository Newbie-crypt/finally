"""Tests for connection handling, lazy initialization, and DB path resolution."""

import sqlite3
from pathlib import Path

import pytest

from schema import (
    DB_PATH_ENV_VAR,
    DEFAULT_DB_PATH,
    TABLE_NAMES,
    db_session,
    get_connection,
    get_db_path,
    init_db,
    reset_init_cache,
)
from schema import database as db_module


@pytest.fixture(autouse=True)
def clean_init_cache():
    """Each test starts with a clean 'already initialized' cache."""
    reset_init_cache()
    yield
    reset_init_cache()


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    """A fresh database path inside a temp directory."""
    return tmp_path / "test_finally.db"


def _table_columns(conn: sqlite3.Connection, table: str) -> dict[str, str]:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return {row["name"]: row["type"] for row in rows}


class TestPathResolution:
    """DB path is derived from the module location, not the working directory."""

    def test_default_path_is_project_root_db_dir(self, monkeypatch):
        monkeypatch.delenv("FINALLY_DB_PATH", raising=False)
        path = get_db_path()
        assert path == DEFAULT_DB_PATH
        assert path.name == "finally.db"
        assert path.parent.name == "db"

    def test_default_path_matches_repo_layout(self, monkeypatch):
        """The resolved db/ dir is a sibling of backend/, frontend/ and planning/."""
        monkeypatch.delenv("FINALLY_DB_PATH", raising=False)
        project_root = get_db_path().parent.parent
        assert (project_root / "backend" / "schema" / "database.py").is_file()
        assert (project_root / "planning" / "PLAN.md").is_file()
        assert project_root == db_module.PROJECT_ROOT

    def test_default_path_independent_of_cwd(self, monkeypatch, tmp_path):
        monkeypatch.delenv("FINALLY_DB_PATH", raising=False)
        monkeypatch.chdir(tmp_path)
        assert get_db_path() == DEFAULT_DB_PATH

    def test_env_override(self, monkeypatch, tmp_path):
        target = tmp_path / "custom.db"
        monkeypatch.setenv("FINALLY_DB_PATH", str(target))
        assert get_db_path() == target.resolve()

    def test_blank_env_override_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("FINALLY_DB_PATH", "   ")
        assert get_db_path() == DEFAULT_DB_PATH

    def test_env_var_name_matches_dockerfile(self):
        """The Dockerfile sets FINALLY_DB_PATH; this is the contract with DevOps."""
        assert DB_PATH_ENV_VAR == "FINALLY_DB_PATH"
        dockerfile = (db_module.PROJECT_ROOT / "Dockerfile").read_text(encoding="utf-8")
        assert "FINALLY_DB_PATH=/app/db/finally.db" in dockerfile

    def test_container_layout_fallback(self, monkeypatch, tmp_path):
        """In the image, app/ and schema/ are siblings under /app -> db is /app/db.

        Without this fallback the dev rule (two levels up) would resolve to the root
        filesystem. FINALLY_DB_PATH normally takes precedence, but the fallback must
        still be sane if it is ever unset.
        """
        app_root = tmp_path / "app"
        (app_root / "schema").mkdir(parents=True)
        monkeypatch.setattr(db_module, "_MODULE_DIR", app_root / "schema")

        assert db_module._default_db_path() == app_root / "db" / "finally.db"

    def test_dev_layout_fallback(self, monkeypatch, tmp_path):
        """In a checkout, backend/schema/ -> <project-root>/db/finally.db."""
        schema_dir = tmp_path / "backend" / "schema"
        schema_dir.mkdir(parents=True)
        (schema_dir / "database.py").touch()
        monkeypatch.setattr(db_module, "_MODULE_DIR", schema_dir)

        assert db_module._default_db_path() == tmp_path / "db" / "finally.db"


class TestInitDb:
    """Lazy initialization creates the schema and is idempotent."""

    def test_creates_file_and_parent_dirs(self, tmp_path):
        target = tmp_path / "nested" / "dir" / "finally.db"
        returned = init_db(target)
        assert returned == target.resolve()
        assert target.exists()

    def test_creates_all_six_tables(self, db_path):
        init_db(db_path)
        conn = sqlite3.connect(db_path)
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
        conn.close()
        names = {row[0] for row in rows}
        for table in TABLE_NAMES:
            assert table in names
        assert len(TABLE_NAMES) == 6

    def test_idempotent_across_calls(self, db_path):
        init_db(db_path)
        with db_session(db_path) as conn:
            conn.execute(
                "UPDATE users_profile SET cash_balance = ? WHERE id = 'default'", (1234.0,)
            )

        # Re-init (simulating a restart) must not wipe or reseed existing data.
        reset_init_cache()
        init_db(db_path)
        with db_session(db_path) as conn:
            cash = conn.execute(
                "SELECT cash_balance FROM users_profile WHERE id = 'default'"
            ).fetchone()["cash_balance"]
            profiles = conn.execute("SELECT COUNT(*) AS n FROM users_profile").fetchone()["n"]
            watch = conn.execute("SELECT COUNT(*) AS n FROM watchlist").fetchone()["n"]

        assert cash == 1234.0
        assert profiles == 1
        assert watch == 10

    def test_uses_env_path_when_no_arg(self, monkeypatch, tmp_path):
        target = tmp_path / "env.db"
        monkeypatch.setenv("FINALLY_DB_PATH", str(target))
        init_db()
        assert target.exists()


class TestSchemaColumns:
    """Each table has exactly the columns specified in PLAN.md §7."""

    @pytest.fixture
    def conn(self, db_path):
        connection = get_connection(db_path)
        yield connection
        connection.close()

    def test_users_profile_columns(self, conn):
        cols = _table_columns(conn, "users_profile")
        assert set(cols) == {"id", "cash_balance", "created_at"}
        assert "user_id" not in cols  # `id` IS the user identifier here

    def test_watchlist_columns(self, conn):
        assert set(_table_columns(conn, "watchlist")) == {"id", "user_id", "ticker", "added_at"}

    def test_positions_columns(self, conn):
        assert set(_table_columns(conn, "positions")) == {
            "id",
            "user_id",
            "ticker",
            "quantity",
            "avg_cost",
            "updated_at",
        }

    def test_trades_columns(self, conn):
        assert set(_table_columns(conn, "trades")) == {
            "id",
            "user_id",
            "ticker",
            "side",
            "quantity",
            "price",
            "executed_at",
        }

    def test_portfolio_snapshots_columns(self, conn):
        assert set(_table_columns(conn, "portfolio_snapshots")) == {
            "id",
            "user_id",
            "total_value",
            "recorded_at",
        }

    def test_chat_messages_columns(self, conn):
        assert set(_table_columns(conn, "chat_messages")) == {
            "id",
            "user_id",
            "role",
            "content",
            "actions",
            "created_at",
        }

    def test_user_id_defaults_to_default(self, conn):
        """All five non-profile tables default user_id to 'default'."""
        conn.execute("INSERT INTO watchlist (id, ticker, added_at) VALUES ('w1', 'ABC', 'now')")
        conn.execute(
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at)"
            " VALUES ('p1', 'ABC', 1, 1.0, 'now')"
        )
        conn.execute(
            "INSERT INTO trades (id, ticker, side, quantity, price, executed_at)"
            " VALUES ('t1', 'ABC', 'buy', 1, 1.0, 'now')"
        )
        conn.execute(
            "INSERT INTO portfolio_snapshots (id, total_value, recorded_at)"
            " VALUES ('s1', 100.0, 'now')"
        )
        conn.execute(
            "INSERT INTO chat_messages (id, role, content, created_at)"
            " VALUES ('c1', 'user', 'hi', 'now')"
        )
        conn.commit()

        for table in ("watchlist", "positions", "trades", "portfolio_snapshots", "chat_messages"):
            row = conn.execute(f"SELECT user_id FROM {table} LIMIT 1").fetchone()
            assert row["user_id"] == "default", table

    def test_users_profile_defaults(self, db_path):
        """id and cash_balance have the PLAN-specified defaults."""
        conn = get_connection(db_path)
        conn.execute("DELETE FROM users_profile")
        conn.execute("INSERT INTO users_profile (created_at) VALUES ('now')")
        conn.commit()
        row = conn.execute("SELECT id, cash_balance FROM users_profile").fetchone()
        conn.close()
        assert row["id"] == "default"
        assert row["cash_balance"] == 10000.0


class TestConstraints:
    """UNIQUE and CHECK constraints behave as specified."""

    @pytest.fixture
    def conn(self, db_path):
        connection = get_connection(db_path)
        yield connection
        connection.close()

    def test_watchlist_unique_user_ticker(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO watchlist (id, user_id, ticker, added_at)"
                " VALUES ('dup', 'default', 'AAPL', 'now')"
            )

    def test_watchlist_same_ticker_different_user_allowed(self, conn):
        conn.execute(
            "INSERT INTO watchlist (id, user_id, ticker, added_at)"
            " VALUES ('other', 'someone-else', 'AAPL', 'now')"
        )
        conn.commit()
        n = conn.execute("SELECT COUNT(*) AS n FROM watchlist WHERE ticker = 'AAPL'").fetchone()["n"]
        assert n == 2

    def test_positions_unique_user_ticker(self, conn):
        conn.execute(
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at)"
            " VALUES ('p1', 'AAPL', 10, 190.0, 'now')"
        )
        conn.commit()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at)"
                " VALUES ('p2', 'AAPL', 5, 195.0, 'now')"
            )

    def test_positions_allow_fractional_quantity(self, conn):
        conn.execute(
            "INSERT INTO positions (id, ticker, quantity, avg_cost, updated_at)"
            " VALUES ('p1', 'AAPL', 2.5, 190.25, 'now')"
        )
        conn.commit()
        row = conn.execute("SELECT quantity FROM positions WHERE id = 'p1'").fetchone()
        assert row["quantity"] == 2.5

    def test_trade_side_check(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO trades (id, ticker, side, quantity, price, executed_at)"
                " VALUES ('t1', 'AAPL', 'short', 1, 1.0, 'now')"
            )

    def test_chat_role_check(self, conn):
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO chat_messages (id, role, content, created_at)"
                " VALUES ('c1', 'system', 'hi', 'now')"
            )

    def test_chat_actions_nullable(self, conn):
        conn.execute(
            "INSERT INTO chat_messages (id, role, content, created_at)"
            " VALUES ('c1', 'user', 'hi', 'now')"
        )
        conn.commit()
        row = conn.execute("SELECT actions FROM chat_messages WHERE id = 'c1'").fetchone()
        assert row["actions"] is None


class TestConnections:
    """get_connection / db_session behaviour."""

    def test_get_connection_initializes_lazily(self, db_path):
        assert not db_path.exists()
        conn = get_connection(db_path)
        row = conn.execute("SELECT COUNT(*) AS n FROM watchlist").fetchone()
        conn.close()
        assert db_path.exists()
        assert row["n"] == 10

    def test_row_factory_is_row(self, db_path):
        conn = get_connection(db_path)
        row = conn.execute("SELECT id, cash_balance FROM users_profile").fetchone()
        conn.close()
        assert isinstance(row, sqlite3.Row)
        assert row["id"] == "default"
        assert row[0] == "default"

    def test_db_session_commits(self, db_path):
        with db_session(db_path) as conn:
            conn.execute("UPDATE users_profile SET cash_balance = 42.0 WHERE id = 'default'")

        with db_session(db_path) as conn:
            cash = conn.execute("SELECT cash_balance FROM users_profile").fetchone()["cash_balance"]
        assert cash == 42.0

    def test_db_session_rolls_back_on_error(self, db_path):
        init_db(db_path)
        with pytest.raises(RuntimeError):
            with db_session(db_path) as conn:
                conn.execute("UPDATE users_profile SET cash_balance = 0.0 WHERE id = 'default'")
                raise RuntimeError("boom")

        with db_session(db_path) as conn:
            cash = conn.execute("SELECT cash_balance FROM users_profile").fetchone()["cash_balance"]
        assert cash == 10000.0

    def test_get_connection_uses_env_path(self, monkeypatch, tmp_path):
        target = tmp_path / "env.db"
        monkeypatch.setenv("FINALLY_DB_PATH", str(target))
        conn = get_connection()
        conn.close()
        assert target.exists()
