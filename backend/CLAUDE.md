# Backend — Developer Guide

## Project Setup

```bash
cd backend
uv sync --extra dev   # Install all dependencies including test/lint tools
```

## Database API

The schema, seed data, and lazy initialization live in `schema/` (top-level in `backend/`, importable as `schema`). Use these imports:

```python
from schema import (
    get_connection, db_session, init_db, get_db_path,
    DEFAULT_USER_ID, DEFAULT_CASH_BALANCE, DEFAULT_WATCHLIST, utc_now_iso,
)
```

- **`get_connection(db_path=None) -> sqlite3.Connection`** — Opens a connection, lazily creating + seeding the DB on first use. `row_factory` is `sqlite3.Row` (index *and* column-name access). Caller must close it.
- **`db_session(db_path=None)`** — Context manager wrapping `get_connection`: commits on success, rolls back on exception, always closes. Preferred for writes.
- **`init_db(db_path=None, *, force=False) -> Path`** — Creates schema + seeds defaults. Idempotent; call once at app startup (optional — `get_connection` does it lazily).
- **`get_db_path() -> Path`** — Resolves to `<project-root>/db/finally.db` (derived from the module's file location, never the CWD). Override with the **`FINALLY_DB_PATH`** env var, which the Dockerfile sets to `/app/db/finally.db` (the volume mount).
- **`utc_now_iso() -> str`** — ISO-8601 UTC timestamp; use for all `*_at` columns.
- Constants: `DEFAULT_USER_ID` (`"default"`), `DEFAULT_CASH_BALANCE` (`10000.0`), `DEFAULT_WATCHLIST` (10 tickers), `TABLE_NAMES`, `DEFAULT_DB_PATH`.

Tables (see PLAN.md §7): `users_profile`, `watchlist`, `positions`, `trades`, `portfolio_snapshots`, `chat_messages`. All tables except `users_profile` have a `user_id TEXT DEFAULT 'default'`; `users_profile.id` *is* the user identifier. UNIQUE on `watchlist(user_id, ticker)` and `positions(user_id, ticker)`; CHECK on `trades.side` (`buy`/`sell`) and `chat_messages.role` (`user`/`assistant`). Seeding only runs on a fresh DB — removed default tickers never reappear on restart.

```python
with db_session() as conn:
    conn.execute(
        "INSERT INTO trades (id, ticker, side, quantity, price, executed_at) VALUES (?, ?, ?, ?, ?, ?)",
        (str(uuid.uuid4()), "AAPL", "buy", 10, 190.0, utc_now_iso()),
    )
```

## Market Data API

The market data subsystem lives in `app/market/`. Use these imports:

```python
from app.market import PriceCache, PriceUpdate, MarketDataSource, create_market_data_source
```

### Core Types

- **`PriceUpdate`** — Immutable dataclass: `ticker`, `price`, `previous_price`, `timestamp`, plus properties `change`, `change_percent`, `direction` ("up"/"down"/"flat"), and `to_dict()` for JSON serialization.

- **`PriceCache`** — Thread-safe in-memory store. Key methods:
  - `update(ticker, price, timestamp=None) -> PriceUpdate`
  - `get(ticker) -> PriceUpdate | None`
  - `get_price(ticker) -> float | None`
  - `get_all() -> dict[str, PriceUpdate]`
  - `remove(ticker)`
  - `version` property — monotonic counter, increments on every update (for SSE change detection)

- **`MarketDataSource`** — Abstract interface implemented by `SimulatorDataSource` and `MassiveDataSource`. Lifecycle: `start(tickers)` -> `add_ticker()` / `remove_ticker()` -> `stop()`.

- **`create_market_data_source(cache)`** — Factory. Returns `MassiveDataSource` if `MASSIVE_API_KEY` is set, otherwise `SimulatorDataSource`.

### SSE Streaming

```python
from app.market import create_stream_router

router = create_stream_router(price_cache)  # Returns FastAPI APIRouter
# Endpoint: GET /api/stream/prices (text/event-stream)
```

### Seed Data

Default tickers: AAPL, GOOGL, MSFT, AMZN, TSLA, NVDA, META, JPM, V, NFLX. Seed prices and per-ticker volatility/drift params are in `app/market/seed_prices.py`.

## Running Tests

```bash
uv run --extra dev pytest -v              # All tests
uv run --extra dev pytest --cov=app       # With coverage
uv run --extra dev ruff check app/ tests/ # Lint
```

## Demo

```bash
uv run market_data_demo.py   # Live terminal dashboard with simulated prices
```
