"""Fixtures for the API tests: an isolated DB and a TestClient with a fake market feed."""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.market import MarketDataSource, PriceCache
from schema import DB_PATH_ENV_VAR, DEFAULT_USER_ID, db_session, init_db, reset_init_cache

SEED_PRICES = {
    "AAPL": 190.0,
    "GOOGL": 175.0,
    "MSFT": 420.0,
    "TSLA": 250.0,
    "NVDA": 900.0,
    "AMZN": 180.0,
    "META": 500.0,
    "JPM": 200.0,
    "V": 280.0,
    "NFLX": 600.0,
}

NEW_TICKER_PRICE = 42.0


class FakeMarketDataSource(MarketDataSource):
    """Deterministic stand-in for the simulator: seeds a known price per ticker."""

    def __init__(self, price_cache: PriceCache) -> None:
        self._cache = price_cache
        self._tickers: list[str] = []
        self.started = False
        self.stopped = False

    async def start(self, tickers: list[str]) -> None:
        self.started = True
        for ticker in tickers:
            await self.add_ticker(ticker)

    async def stop(self) -> None:
        self.stopped = True

    async def add_ticker(self, ticker: str) -> None:
        if ticker not in self._tickers:
            self._tickers.append(ticker)
        self._cache.update(ticker, SEED_PRICES.get(ticker, NEW_TICKER_PRICE))

    async def remove_ticker(self, ticker: str) -> None:
        self._tickers = [t for t in self._tickers if t != ticker]
        self._cache.remove(ticker)

    def get_tickers(self) -> list[str]:
        return list(self._tickers)


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    """Point every DB call at a fresh SQLite file for the duration of the test."""
    reset_init_cache()
    db_path = tmp_path / "test_finally.db"
    monkeypatch.setenv(DB_PATH_ENV_VAR, str(db_path))
    init_db(db_path, force=True)
    yield db_path
    reset_init_cache()


@pytest.fixture
def fake_source(monkeypatch) -> None:
    """Replace the market data factory so the app starts with the deterministic feed."""

    def factory(price_cache: PriceCache) -> MarketDataSource:
        return FakeMarketDataSource(price_cache)

    # The periodic snapshot task sleeps 30s before its first write, so it never fires
    # during a test — no need to stub it out.
    monkeypatch.setattr("app.main.create_market_data_source", factory)


@pytest.fixture
def client(isolated_db, fake_source) -> TestClient:
    """TestClient with lifespan run (market feed started, prices cached)."""
    from app.main import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def set_cash(amount: float) -> None:
    """Force the cash balance (to set up insufficient-funds scenarios)."""
    with db_session() as conn:
        conn.execute(
            "UPDATE users_profile SET cash_balance = ? WHERE id = ?", (amount, DEFAULT_USER_ID)
        )
