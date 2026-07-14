"""Shared fixtures: isolated temp DB, a populated PriceCache, and a test FastAPI app."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.chat import router as chat_router
from app.market import PriceCache
from schema import init_db, reset_init_cache

SEED_PRICES = {"AAPL": 190.0, "GOOGL": 175.0, "MSFT": 400.0, "TSLA": 250.0, "PYPL": 60.0}


@pytest.fixture(autouse=True)
def clean_init_cache():
    reset_init_cache()
    yield
    reset_init_cache()


@pytest.fixture(autouse=True)
def mock_llm(monkeypatch):
    """All tests run in LLM_MOCK mode unless they explicitly override it."""
    monkeypatch.setenv("LLM_MOCK", "true")


@pytest.fixture
def db_path(tmp_path: Path) -> Path:
    path = tmp_path / "chat_test.db"
    init_db(path, force=True)
    return path


@pytest.fixture
def price_cache() -> PriceCache:
    cache = PriceCache()
    for ticker, price in SEED_PRICES.items():
        cache.update(ticker, price)
    return cache


@pytest.fixture
def app(db_path: Path, price_cache: PriceCache) -> FastAPI:
    application = FastAPI()
    application.include_router(chat_router)
    application.state.price_cache = price_cache
    application.state.db_path = db_path
    return application


@pytest.fixture
def client(app: FastAPI) -> TestClient:
    return TestClient(app)
