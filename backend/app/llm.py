"""LLM integration for the FinAlly chat assistant (planning/PLAN.md §9).

Calls `openrouter/openai/gpt-oss-120b` through LiteLLM -> OpenRouter with Cerebras
pinned as the inference provider (per the `cerebras-inference` skill), requesting a
structured output that matches :class:`ChatCompletionResponse`.

Mock mode: when the ``LLM_MOCK`` env var is truthy ("true"/"1"/"yes"), no network call
is made at all — :func:`mock_response` produces a deterministic response derived from
the user's message. See its docstring for the exact keyword rules (the E2E suite
depends on them).
"""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError

logger = logging.getLogger(__name__)

MODEL = "openrouter/nvidia/nemotron-3-ultra-550b-a55b:free"
EXTRA_BODY = {"provider": {"order": ["cerebras"]}}
REASONING_EFFORT = "low"

MAX_HISTORY_MESSAGES = 20


class LLMError(RuntimeError):
    """Raised when the LLM call fails or returns an unusable response.

    PLAN.md §9: the chat endpoint turns this into HTTP 502 + ``{"error": "..."}``
    and writes no ``chat_messages`` row.
    """


# --------------------------------------------------------------------------------------
# Structured output schema (PLAN.md §9)
# --------------------------------------------------------------------------------------


class TradeAction(BaseModel):
    """A single market order the assistant wants to execute."""

    ticker: str = Field(description="Ticker symbol, e.g. AAPL")
    side: Literal["buy", "sell"]
    quantity: float = Field(gt=0, description="Number of shares (fractional allowed)")


class WatchlistChange(BaseModel):
    """A single watchlist modification."""

    ticker: str = Field(description="Ticker symbol, e.g. PYPL")
    action: Literal["add", "remove"]


class ChatCompletionResponse(BaseModel):
    """The exact JSON shape the LLM must return."""

    message: str = Field(description="Conversational response shown to the user")
    trades: list[TradeAction] = Field(default_factory=list)
    watchlist_changes: list[WatchlistChange] = Field(default_factory=list)


# --------------------------------------------------------------------------------------
# Prompting
# --------------------------------------------------------------------------------------

SYSTEM_PROMPT = """You are FinAlly, an AI trading assistant embedded in a simulated \
trading workstation. The user trades a virtual $10,000 portfolio — there is no real money.

Your job:
- Analyze portfolio composition, risk concentration, and P&L using the live data provided.
- Suggest trades with clear, data-driven reasoning.
- Execute trades when the user asks for them or agrees to a suggestion (market orders, \
instant fill at the current price). Only buys with sufficient cash and sells of shares \
actually held will succeed.
- Manage the watchlist proactively — add tickers you discuss, remove ones that no longer matter.
- Be concise. Cite concrete numbers. No filler, no disclaimers about not being a financial advisor.

Rules:
- Always respond with valid JSON matching the required schema.
- `message` is your conversational reply (required).
- `trades` is a list of orders to execute now — leave it empty unless the user clearly wants \
a trade executed. Never invent quantities the user did not ask for without saying so in `message`.
- `watchlist_changes` is a list of {ticker, action} where action is "add" or "remove".
- Tickers are uppercase symbols. Any ticker may be traded; a successful trade auto-adds it to \
the watchlist."""


def format_portfolio_context(context: dict[str, Any]) -> str:
    """Render the portfolio context dict as a compact text block for the prompt."""
    lines = [
        "CURRENT PORTFOLIO",
        f"Cash: ${context['cash_balance']:,.2f}",
        f"Positions value: ${context['positions_value']:,.2f}",
        f"Total portfolio value: ${context['total_value']:,.2f}",
        f"Total unrealized P&L: ${context['total_unrealized_pnl']:,.2f}",
        "",
        "POSITIONS",
    ]
    if context["positions"]:
        for p in context["positions"]:
            price = f"${p['current_price']:,.2f}" if p["current_price"] is not None else "n/a"
            lines.append(
                f"- {p['ticker']}: {p['quantity']:g} shares @ avg ${p['avg_cost']:,.2f}, "
                f"last {price}, unrealized P&L ${p['unrealized_pnl']:,.2f} "
                f"({p['unrealized_pnl_percent']:+.2f}%)"
            )
    else:
        lines.append("- (none)")

    lines += ["", "WATCHLIST"]
    if context["watchlist"]:
        for w in context["watchlist"]:
            price = f"${w['price']:,.2f}" if w["price"] is not None else "n/a"
            lines.append(f"- {w['ticker']}: {price}")
    else:
        lines.append("- (empty)")

    return "\n".join(lines)


def build_messages(
    user_message: str,
    context: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    """Assemble the chat message list: system prompt + context + history + new message."""
    messages: list[dict[str, str]] = [
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "system", "content": format_portfolio_context(context)},
    ]
    for row in (history or [])[-MAX_HISTORY_MESSAGES:]:
        role = row["role"] if row["role"] in ("user", "assistant") else "user"
        messages.append({"role": role, "content": str(row["content"])})
    messages.append({"role": "user", "content": user_message})
    return messages


# --------------------------------------------------------------------------------------
# Mock mode
# --------------------------------------------------------------------------------------

_TRADE_RE = re.compile(
    r"\b(buy|sell)\s+(\d+(?:\.\d+)?)\s+(?:shares?\s+(?:of\s+)?)?([A-Za-z]{1,5})\b",
    re.IGNORECASE,
)
_WATCH_ADD_RE = re.compile(
    r"\badd\s+([A-Za-z]{1,5})\s+to\s+(?:the\s+|my\s+)*watchlist\b", re.IGNORECASE
)
_WATCH_REMOVE_RE = re.compile(
    r"\bremove\s+([A-Za-z]{1,5})\s+from\s+(?:the\s+|my\s+)*watchlist\b", re.IGNORECASE
)


def is_mock_enabled() -> bool:
    """True when ``LLM_MOCK`` is set to a truthy value."""
    return os.environ.get("LLM_MOCK", "").strip().lower() in ("true", "1", "yes")


def mock_response(user_message: str, context: dict[str, Any]) -> ChatCompletionResponse:
    """Deterministic stand-in for the LLM. No network call.

    Keyword rules, applied to the raw user message (case-insensitive):

    1. ``buy|sell <qty> [shares [of]] <TICKER>`` -> a trade action, ticker uppercased.
       Every match in the message becomes a trade (e.g. "buy 5 AAPL and sell 2 TSLA").
    2. ``add <TICKER> to [the|my] watchlist`` -> watchlist add.
    3. ``remove <TICKER> from [the|my] watchlist`` -> watchlist remove.
    4. Anything else -> a canned portfolio summary, with no actions.

    The reply text always starts with ``[MOCK]``.
    """
    trades = [
        TradeAction(ticker=m.group(3).upper(), side=m.group(1).lower(), quantity=float(m.group(2)))
        for m in _TRADE_RE.finditer(user_message)
    ]
    changes = [
        WatchlistChange(ticker=m.group(1).upper(), action="add")
        for m in _WATCH_ADD_RE.finditer(user_message)
    ] + [
        WatchlistChange(ticker=m.group(1).upper(), action="remove")
        for m in _WATCH_REMOVE_RE.finditer(user_message)
    ]

    parts: list[str] = []
    if trades:
        orders = ", ".join(f"{t.side} {t.quantity:g} {t.ticker}" for t in trades)
        parts.append(f"Order routed: {orders}.")
    if changes:
        edits = ", ".join(f"{c.action} {c.ticker}" for c in changes)
        parts.append(f"Watchlist update: {edits}.")
    if not parts:
        parts.append(
            f"FinAlly mock assistant. Cash ${context['cash_balance']:,.2f}, "
            f"{len(context['positions'])} position(s), "
            f"total value ${context['total_value']:,.2f}."
        )

    return ChatCompletionResponse(
        message="[MOCK] " + " ".join(parts), trades=trades, watchlist_changes=changes
    )


# --------------------------------------------------------------------------------------
# Real LLM call
# --------------------------------------------------------------------------------------


def _parse_completion(raw: str | None) -> ChatCompletionResponse:
    """Validate the model's structured output; raise LLMError if unusable."""
    if not raw or not raw.strip():
        raise LLMError("LLM returned an empty response")
    try:
        return ChatCompletionResponse.model_validate_json(raw)
    except ValidationError as exc:
        logger.warning("Invalid LLM structured output: %s", exc)
        raise LLMError("LLM returned a response that did not match the expected schema") from exc
    except (json.JSONDecodeError, ValueError) as exc:
        logger.warning("Unparseable LLM output: %s", exc)
        raise LLMError("LLM returned an unparseable response") from exc


def call_llm(
    user_message: str,
    context: dict[str, Any],
    history: list[dict[str, Any]] | None = None,
) -> ChatCompletionResponse:
    """Get a structured chat response — mock or real, depending on ``LLM_MOCK``.

    Raises:
        LLMError: the call failed (network/timeout/auth) or the output was invalid.
    """
    if is_mock_enabled():
        return mock_response(user_message, context)

    messages = build_messages(user_message, context, history)

    try:
        from litellm import completion  # imported lazily: keeps mock mode import-light
        response = completion(
            model=MODEL,
            messages=messages,
            response_format=ChatCompletionResponse,
        )
        raw = response.choices[0].message.content
    except LLMError:
        raise
    except Exception as exc:  # network error, timeout, auth failure, bad payload...
        logger.exception("LLM call failed")
        raise LLMError(f"LLM request failed: {exc}") from exc

    return _parse_completion(raw)
