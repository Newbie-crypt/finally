"""Portfolio endpoints: valuation, trade execution, and history."""

from __future__ import annotations

from schema import DEFAULT_CASH_BALANCE, DEFAULT_USER_ID, db_session

from .conftest import NEW_TICKER_PRICE, SEED_PRICES, set_cash


def _trade(client, ticker: str, side: str, quantity: float):
    return client.post(
        "/api/portfolio/trade",
        json={"ticker": ticker, "side": side, "quantity": quantity},
    )


class TestGetPortfolio:
    def test_fresh_portfolio_is_all_cash(self, client):
        body = client.get("/api/portfolio").json()
        assert body["cash_balance"] == DEFAULT_CASH_BALANCE
        assert body["positions"] == []
        assert body["positions_value"] == 0.0
        assert body["total_value"] == DEFAULT_CASH_BALANCE
        assert body["total_unrealized_pnl"] == 0.0

    def test_position_is_valued_at_the_live_price(self, client):
        assert _trade(client, "AAPL", "buy", 10).status_code == 200

        # A price move after the fill shows up as unrealized P&L.
        client.app.state.price_cache.update("AAPL", 200.0)

        body = client.get("/api/portfolio").json()
        position = body["positions"][0]
        assert position["ticker"] == "AAPL"
        assert position["quantity"] == 10
        assert position["avg_cost"] == SEED_PRICES["AAPL"]
        assert position["current_price"] == 200.0
        assert position["market_value"] == 2000.0
        assert position["unrealized_pnl"] == 100.0
        assert position["unrealized_pnl_percent"] == 5.26
        assert body["total_value"] == round(body["cash_balance"] + 2000.0, 2)
        assert body["total_unrealized_pnl"] == 100.0


class TestBuy:
    def test_buy_debits_cash_and_opens_a_position(self, client):
        response = _trade(client, "AAPL", "buy", 5)
        assert response.status_code == 200

        body = response.json()
        cost = 5 * SEED_PRICES["AAPL"]
        assert body["trade"]["side"] == "buy"
        assert body["trade"]["price"] == SEED_PRICES["AAPL"]
        assert body["portfolio"]["cash_balance"] == round(DEFAULT_CASH_BALANCE - cost, 2)
        assert body["portfolio"]["positions"][0]["quantity"] == 5

    def test_second_buy_averages_the_cost(self, client):
        _trade(client, "AAPL", "buy", 10)  # @ 190
        client.app.state.price_cache.update("AAPL", 210.0)
        _trade(client, "AAPL", "buy", 10)  # @ 210

        position = client.get("/api/portfolio").json()["positions"][0]
        assert position["quantity"] == 20
        assert position["avg_cost"] == 200.0

    def test_insufficient_cash_is_rejected(self, client):
        set_cash(100.0)
        response = _trade(client, "AAPL", "buy", 10)

        assert response.status_code == 400
        assert "Insufficient cash" in response.json()["error"]
        # Nothing was written.
        assert client.get("/api/portfolio").json()["positions"] == []
        assert client.get("/api/portfolio").json()["cash_balance"] == 100.0

    def test_fractional_shares_supported(self, client):
        assert _trade(client, "AAPL", "buy", 0.5).status_code == 200
        assert client.get("/api/portfolio").json()["positions"][0]["quantity"] == 0.5

    def test_non_positive_quantity_is_rejected(self, client):
        assert _trade(client, "AAPL", "buy", 0).status_code == 422
        assert _trade(client, "AAPL", "buy", -3).status_code == 422

    def test_buying_an_unwatched_ticker_adds_it_to_the_watchlist(self, client):
        response = _trade(client, "PYPL", "buy", 2)
        assert response.status_code == 200
        # The fake source seeds unknown tickers at NEW_TICKER_PRICE.
        assert response.json()["trade"]["price"] == NEW_TICKER_PRICE

        tickers = [item["ticker"] for item in client.get("/api/watchlist").json()["watchlist"]]
        assert "PYPL" in tickers
        assert "PYPL" in client.app.state.market_source.get_tickers()


class TestSell:
    def test_sell_credits_cash_and_reduces_the_position(self, client):
        _trade(client, "AAPL", "buy", 10)
        client.app.state.price_cache.update("AAPL", 200.0)

        response = _trade(client, "AAPL", "sell", 4)
        assert response.status_code == 200

        body = response.json()["portfolio"]
        expected_cash = DEFAULT_CASH_BALANCE - 10 * SEED_PRICES["AAPL"] + 4 * 200.0
        assert body["cash_balance"] == round(expected_cash, 2)
        position = body["positions"][0]
        assert position["quantity"] == 6
        # Selling does not change the average cost.
        assert position["avg_cost"] == SEED_PRICES["AAPL"]

    def test_selling_the_whole_position_removes_it(self, client):
        _trade(client, "AAPL", "buy", 3)
        response = _trade(client, "AAPL", "sell", 3)

        assert response.status_code == 200
        assert response.json()["portfolio"]["positions"] == []
        assert client.get("/api/portfolio").json()["cash_balance"] == DEFAULT_CASH_BALANCE

    def test_selling_at_a_loss_is_allowed(self, client):
        _trade(client, "AAPL", "buy", 10)
        client.app.state.price_cache.update("AAPL", 150.0)

        response = _trade(client, "AAPL", "sell", 10)
        assert response.status_code == 200
        cash = response.json()["portfolio"]["cash_balance"]
        assert cash == round(DEFAULT_CASH_BALANCE - 10 * SEED_PRICES["AAPL"] + 1500.0, 2)

    def test_insufficient_shares_is_rejected(self, client):
        _trade(client, "AAPL", "buy", 2)
        response = _trade(client, "AAPL", "sell", 5)

        assert response.status_code == 400
        assert "Insufficient shares" in response.json()["error"]
        assert client.get("/api/portfolio").json()["positions"][0]["quantity"] == 2

    def test_selling_a_ticker_never_held_is_rejected(self, client):
        response = _trade(client, "MSFT", "sell", 1)
        assert response.status_code == 400
        assert "Insufficient shares" in response.json()["error"]


class TestTradeSideEffects:
    def test_trade_row_is_appended(self, client):
        _trade(client, "AAPL", "buy", 1)
        _trade(client, "AAPL", "sell", 1)

        with db_session() as conn:
            rows = conn.execute(
                "SELECT ticker, side, quantity FROM trades WHERE user_id = ? ORDER BY executed_at",
                (DEFAULT_USER_ID,),
            ).fetchall()
        assert [row["side"] for row in rows] == ["buy", "sell"]
        assert all(row["ticker"] == "AAPL" for row in rows)

    def test_each_trade_records_a_snapshot(self, client):
        _trade(client, "AAPL", "buy", 1)
        _trade(client, "GOOGL", "buy", 1)

        snapshots = client.get("/api/portfolio/history").json()["snapshots"]
        assert len(snapshots) == 2
        assert snapshots[0]["total_value"] > 0
        assert snapshots[0]["recorded_at"] <= snapshots[1]["recorded_at"]

    def test_history_is_empty_before_any_trade(self, client):
        assert client.get("/api/portfolio/history").json()["snapshots"] == []
