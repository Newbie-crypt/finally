"""Watchlist CRUD."""

from __future__ import annotations

from schema import DEFAULT_WATCHLIST

from .conftest import SEED_PRICES


def _tickers(client) -> list[str]:
    return [item["ticker"] for item in client.get("/api/watchlist").json()["watchlist"]]


class TestGetWatchlist:
    def test_defaults_are_seeded_with_prices(self, client):
        items = client.get("/api/watchlist").json()["watchlist"]

        assert {item["ticker"] for item in items} == set(DEFAULT_WATCHLIST)
        aapl = next(item for item in items if item["ticker"] == "AAPL")
        assert aapl["price"] == SEED_PRICES["AAPL"]
        assert aapl["direction"] == "flat"
        assert aapl["added_at"]

    def test_price_direction_reflects_the_latest_tick(self, client):
        client.app.state.price_cache.update("AAPL", 195.0)

        aapl = next(
            item for item in client.get("/api/watchlist").json()["watchlist"]
            if item["ticker"] == "AAPL"
        )
        assert aapl["price"] == 195.0
        assert aapl["previous_price"] == SEED_PRICES["AAPL"]
        assert aapl["direction"] == "up"
        assert aapl["change"] == 5.0


class TestAddTicker:
    def test_add_tracks_the_ticker_and_returns_the_list(self, client):
        response = client.post("/api/watchlist", json={"ticker": "pypl"})

        assert response.status_code == 201
        body = response.json()
        assert body["ticker"] == "PYPL"
        assert "PYPL" in [item["ticker"] for item in body["watchlist"]]
        assert "PYPL" in client.app.state.market_source.get_tickers()
        assert client.app.state.price_cache.get_price("PYPL") is not None

    def test_adding_an_existing_ticker_is_idempotent(self, client):
        client.post("/api/watchlist", json={"ticker": "AAPL"})
        assert _tickers(client).count("AAPL") == 1

    def test_invalid_ticker_is_rejected(self, client):
        assert client.post("/api/watchlist", json={"ticker": ""}).status_code == 422
        assert client.post("/api/watchlist", json={"ticker": "AA PL1"}).status_code == 422


class TestRemoveTicker:
    def test_remove_drops_it_from_the_list_and_the_feed(self, client):
        response = client.delete("/api/watchlist/AAPL")

        assert response.status_code == 200
        assert "AAPL" not in [item["ticker"] for item in response.json()["watchlist"]]
        assert "AAPL" not in _tickers(client)
        assert "AAPL" not in client.app.state.market_source.get_tickers()
        assert client.app.state.price_cache.get_price("AAPL") is None

    def test_removing_an_absent_ticker_is_404(self, client):
        response = client.delete("/api/watchlist/PYPL")
        assert response.status_code == 404
        assert "error" in response.json()

    def test_lowercase_path_is_normalized(self, client):
        assert client.delete("/api/watchlist/aapl").status_code == 200
        assert "AAPL" not in _tickers(client)
