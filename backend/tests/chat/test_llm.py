"""Tests for structured-output parsing, prompt building, and LLM_MOCK behavior."""

from __future__ import annotations

import pytest

from app.llm import (
    ChatCompletionResponse,
    LLMError,
    _parse_completion,
    build_messages,
    call_llm,
    format_portfolio_context,
    is_mock_enabled,
    mock_response,
)

CONTEXT = {
    "cash_balance": 10000.0,
    "positions": [
        {
            "ticker": "AAPL",
            "quantity": 10,
            "avg_cost": 180.0,
            "current_price": 190.0,
            "market_value": 1900.0,
            "unrealized_pnl": 100.0,
            "unrealized_pnl_percent": 5.56,
        }
    ],
    "positions_value": 1900.0,
    "total_value": 11900.0,
    "total_unrealized_pnl": 100.0,
    "watchlist": [{"ticker": "AAPL", "price": 190.0}, {"ticker": "TSLA", "price": None}],
}

EMPTY_CONTEXT = {
    "cash_balance": 10000.0,
    "positions": [],
    "positions_value": 0.0,
    "total_value": 10000.0,
    "total_unrealized_pnl": 0.0,
    "watchlist": [],
}


class TestStructuredOutputParsing:
    def test_full_schema(self):
        raw = """{"message": "Bought.",
                  "trades": [{"ticker": "AAPL", "side": "buy", "quantity": 10}],
                  "watchlist_changes": [{"ticker": "PYPL", "action": "add"}]}"""
        parsed = _parse_completion(raw)
        assert parsed.message == "Bought."
        assert parsed.trades[0].ticker == "AAPL"
        assert parsed.trades[0].side == "buy"
        assert parsed.trades[0].quantity == 10
        assert parsed.watchlist_changes[0].action == "add"

    def test_message_only_defaults_to_empty_action_lists(self):
        parsed = _parse_completion('{"message": "Hello"}')
        assert parsed.trades == []
        assert parsed.watchlist_changes == []

    def test_fractional_quantity(self):
        parsed = _parse_completion(
            '{"message": "ok", "trades": [{"ticker": "NVDA", "side": "sell", "quantity": 0.5}]}'
        )
        assert parsed.trades[0].quantity == 0.5

    @pytest.mark.parametrize(
        "raw",
        [
            "",
            "   ",
            "not json at all",
            "{",
            '{"trades": []}',  # missing required `message`
            '{"message": "x", "trades": [{"ticker": "AAPL", "side": "hold", "quantity": 1}]}',
            '{"message": "x", "trades": [{"ticker": "AAPL", "side": "buy", "quantity": -3}]}',
            '{"message": "x", "watchlist_changes": [{"ticker": "AAPL", "action": "flip"}]}',
        ],
    )
    def test_malformed_or_invalid_raises_llm_error(self, raw):
        with pytest.raises(LLMError):
            _parse_completion(raw)

    def test_none_raises(self):
        with pytest.raises(LLMError):
            _parse_completion(None)


class TestPromptBuilding:
    def test_context_block_includes_numbers(self):
        text = format_portfolio_context(CONTEXT)
        assert "$10,000.00" in text
        assert "AAPL" in text
        assert "$11,900.00" in text

    def test_empty_portfolio_renders(self):
        text = format_portfolio_context(EMPTY_CONTEXT)
        assert "(none)" in text
        assert "(empty)" in text

    def test_messages_shape(self):
        history = [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"},
        ]
        messages = build_messages("buy 1 AAPL", CONTEXT, history)
        assert messages[0]["role"] == "system"
        assert "FinAlly" in messages[0]["content"]
        assert messages[1]["role"] == "system"
        assert messages[-1] == {"role": "user", "content": "buy 1 AAPL"}
        assert len(messages) == 5

    def test_history_is_capped(self):
        history = [{"role": "user", "content": str(i)} for i in range(100)]
        messages = build_messages("hi", CONTEXT, history)
        assert len(messages) == 2 + 20 + 1


class TestMockMode:
    def test_is_mock_enabled(self, monkeypatch):
        for value in ("true", "TRUE", "1", "yes"):
            monkeypatch.setenv("LLM_MOCK", value)
            assert is_mock_enabled()
        for value in ("false", "0", ""):
            monkeypatch.setenv("LLM_MOCK", value)
            assert not is_mock_enabled()

    def test_buy_keyword_produces_trade(self):
        resp = mock_response("Please buy 10 AAPL now", CONTEXT)
        assert len(resp.trades) == 1
        assert resp.trades[0].model_dump() == {"ticker": "AAPL", "side": "buy", "quantity": 10.0}
        assert resp.message.startswith("[MOCK]")

    def test_sell_with_shares_of_phrasing(self):
        resp = mock_response("sell 2.5 shares of tsla", CONTEXT)
        assert resp.trades[0].ticker == "TSLA"
        assert resp.trades[0].side == "sell"
        assert resp.trades[0].quantity == 2.5

    def test_multiple_trades_in_one_message(self):
        resp = mock_response("buy 5 AAPL and sell 2 TSLA", CONTEXT)
        assert [(t.side, t.ticker, t.quantity) for t in resp.trades] == [
            ("buy", "AAPL", 5.0),
            ("sell", "TSLA", 2.0),
        ]

    def test_watchlist_add_and_remove(self):
        resp = mock_response(
            "add PYPL to my watchlist and remove TSLA from the watchlist", CONTEXT
        )
        assert [(c.ticker, c.action) for c in resp.watchlist_changes] == [
            ("PYPL", "add"),
            ("TSLA", "remove"),
        ]
        assert resp.trades == []

    def test_generic_message_returns_canned_summary(self):
        resp = mock_response("how is my portfolio doing?", CONTEXT)
        assert resp.trades == []
        assert resp.watchlist_changes == []
        assert "[MOCK]" in resp.message
        assert "$10,000.00" in resp.message

    def test_deterministic(self):
        a = mock_response("buy 3 MSFT", CONTEXT)
        b = mock_response("buy 3 MSFT", CONTEXT)
        assert a.model_dump() == b.model_dump()

    def test_call_llm_uses_mock_without_network(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "true")
        resp = call_llm("buy 1 AAPL", CONTEXT, [])
        assert isinstance(resp, ChatCompletionResponse)
        assert resp.trades[0].ticker == "AAPL"


class TestRealCallErrorHandling:
    def test_network_failure_becomes_llm_error(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "false")

        def boom(*args, **kwargs):
            raise ConnectionError("connection reset")

        monkeypatch.setattr("litellm.completion", boom)
        with pytest.raises(LLMError, match="LLM request failed"):
            call_llm("hello", CONTEXT, [])

    def test_unparseable_response_becomes_llm_error(self, monkeypatch):
        monkeypatch.setenv("LLM_MOCK", "false")

        class _Msg:
            content = "definitely not json"

        class _Choice:
            message = _Msg()

        class _Resp:
            choices = [_Choice()]

        monkeypatch.setattr("litellm.completion", lambda *a, **k: _Resp())
        with pytest.raises(LLMError):
            call_llm("hello", CONTEXT, [])
