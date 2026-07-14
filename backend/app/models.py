"""Pydantic request/response models for the FinAlly REST API (PLAN.md §8)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator


def normalize_ticker(value: str) -> str:
    """Uppercase, strip, and validate a ticker symbol."""
    ticker = value.strip().upper()
    if not ticker:
        raise ValueError("ticker must not be empty")
    if not ticker.isalpha() or len(ticker) > 10:
        raise ValueError(f"invalid ticker symbol: {value!r}")
    return ticker


class TradeRequest(BaseModel):
    """Body of POST /api/portfolio/trade — a market order, instant fill."""

    ticker: str
    quantity: float = Field(gt=0, description="Shares to trade; fractional allowed")
    side: Literal["buy", "sell"]

    @field_validator("ticker")
    @classmethod
    def _clean_ticker(cls, value: str) -> str:
        return normalize_ticker(value)


class WatchlistRequest(BaseModel):
    """Body of POST /api/watchlist."""

    ticker: str

    @field_validator("ticker")
    @classmethod
    def _clean_ticker(cls, value: str) -> str:
        return normalize_ticker(value)


class Position(BaseModel):
    """A single holding, valued at the latest cached price."""

    ticker: str
    quantity: float
    avg_cost: float
    current_price: float | None
    market_value: float
    cost_basis: float
    unrealized_pnl: float
    unrealized_pnl_percent: float


class Portfolio(BaseModel):
    """Response of GET /api/portfolio."""

    cash_balance: float
    positions: list[Position]
    positions_value: float
    total_value: float
    total_unrealized_pnl: float


class Trade(BaseModel):
    """An executed trade, as stored in the `trades` table."""

    id: str
    ticker: str
    side: Literal["buy", "sell"]
    quantity: float
    price: float
    executed_at: str


class TradeResponse(BaseModel):
    """Response of POST /api/portfolio/trade — the fill plus the refreshed portfolio."""

    trade: Trade
    portfolio: Portfolio


class Snapshot(BaseModel):
    """A portfolio value snapshot (for the P&L chart)."""

    id: str
    total_value: float
    recorded_at: str


class HistoryResponse(BaseModel):
    """Response of GET /api/portfolio/history."""

    snapshots: list[Snapshot]


class WatchlistItem(BaseModel):
    """A watched ticker with its latest price from the cache."""

    ticker: str
    added_at: str
    price: float | None
    previous_price: float | None
    change: float | None
    change_percent: float | None
    direction: str | None
    timestamp: float | None


class WatchlistResponse(BaseModel):
    """Response of GET /api/watchlist."""

    watchlist: list[WatchlistItem]


class WatchlistMutationResponse(BaseModel):
    """Response of POST /api/watchlist and DELETE /api/watchlist/{ticker}."""

    ticker: str
    watchlist: list[WatchlistItem]
