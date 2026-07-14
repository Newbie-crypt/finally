/**
 * Wire types for the FinAlly API (PLAN.md §8).
 *
 * These mirror the backend contract exactly. Anything the UI derives itself
 * (P&L, weights, session change %) lives in `lib/derive.ts` instead, so the
 * UI stays correct even if the backend omits optional convenience fields.
 */

export type Direction = 'up' | 'down' | 'flat';
export type Side = 'buy' | 'sell';

/** SSE event payload from GET /api/stream/prices. */
export interface PriceUpdate {
  ticker: string;
  price: number;
  previous_price: number;
  /** Unix seconds (float). */
  timestamp: number;
  change: number;
  change_percent?: number;
  direction: Direction;
}

/** A single holding as stored by the backend. */
export interface Position {
  ticker: string;
  quantity: number;
  avg_cost: number;
  /** Optional server-side conveniences; the UI recomputes from live prices. */
  current_price?: number;
  market_value?: number;
  unrealized_pnl?: number;
  unrealized_pnl_percent?: number;
}

/** GET /api/portfolio */
export interface Portfolio {
  cash_balance: number;
  positions: Position[];
  total_value?: number;
  unrealized_pnl?: number;
}

/** GET /api/portfolio/history */
export interface Snapshot {
  total_value: number;
  /** ISO timestamp. */
  recorded_at: string;
}

/** POST /api/portfolio/trade */
export interface TradeRequest {
  ticker: string;
  quantity: number;
  side: Side;
}

/** GET /api/watchlist */
export interface WatchlistEntry {
  ticker: string;
  price?: number;
  previous_price?: number;
  change?: number;
  change_percent?: number;
}

/** Actions the LLM executed on the user's behalf (PLAN.md §9). */
export interface ChatTrade {
  ticker: string;
  side: Side;
  quantity: number;
  /** Present when the backend reports a rejected trade. */
  error?: string;
  status?: string;
}

export interface WatchlistChange {
  ticker: string;
  action: 'add' | 'remove';
  error?: string;
}

/** POST /api/chat response body. */
export interface ChatResponse {
  message: string;
  trades?: ChatTrade[];
  watchlist_changes?: WatchlistChange[];
}

/** A row from GET /api/chat (history). */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** JSON blob of executed actions; null for user messages. */
  actions?: ChatActions | string | null;
  created_at?: string;
}

export interface ChatActions {
  trades?: ChatTrade[];
  watchlist_changes?: WatchlistChange[];
}

/** Client-side only: a message in the chat panel, including transient states. */
export interface ChatEntry {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  trades?: ChatTrade[];
  watchlist_changes?: WatchlistChange[];
}

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';
