/**
 * API client for the FinAlly backend (PLAN.md §8).
 *
 * In production the static export is served by FastAPI on the same origin, so
 * every path is relative and no CORS config is needed. For local development
 * against a backend on another port, set NEXT_PUBLIC_API_BASE.
 */

import type {
  ChatMessage,
  ChatResponse,
  Portfolio,
  Snapshot,
  TradeRequest,
  WatchlistEntry,
} from './types';

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? '';

/** Thrown for non-2xx responses; `message` carries the backend's `error` text. */
export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
    ...init,
  });

  if (!res.ok) {
    // The backend's error contract is `{"error": "..."}` (PLAN.md §9). FastAPI's
    // own validation errors use `detail`, so accept either.
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      const detail = body?.error ?? body?.detail;
      if (typeof detail === 'string' && detail) message = detail;
    } catch {
      /* non-JSON error body — keep the status-based message */
    }
    throw new ApiError(message, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * List endpoints may return a bare array or a wrapped object. Normalize both so
 * a backend naming choice can't break the UI.
 */
function asList<T>(payload: unknown, ...keys: string[]): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object') {
    for (const key of keys) {
      const value = (payload as Record<string, unknown>)[key];
      if (Array.isArray(value)) return value as T[];
    }
  }
  return [];
}

export const api = {
  streamUrl: () => `${API_BASE}/api/stream/prices`,

  health: () => request<{ status?: string }>('/api/health'),

  getPortfolio: () => request<Portfolio>('/api/portfolio'),

  getHistory: async (): Promise<Snapshot[]> =>
    asList<Snapshot>(await request<unknown>('/api/portfolio/history'), 'snapshots', 'history'),

  trade: (body: TradeRequest) =>
    request<unknown>('/api/portfolio/trade', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  getWatchlist: async (): Promise<WatchlistEntry[]> =>
    asList<WatchlistEntry>(await request<unknown>('/api/watchlist'), 'watchlist', 'tickers', 'items'),

  addTicker: (ticker: string) =>
    request<unknown>('/api/watchlist', {
      method: 'POST',
      body: JSON.stringify({ ticker: ticker.toUpperCase() }),
    }),

  removeTicker: (ticker: string) =>
    request<unknown>(`/api/watchlist/${encodeURIComponent(ticker.toUpperCase())}`, {
      method: 'DELETE',
    }),

  getChatHistory: async (): Promise<ChatMessage[]> =>
    asList<ChatMessage>(await request<unknown>('/api/chat'), 'messages', 'history'),

  sendChat: (message: string) =>
    request<ChatResponse>('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message }),
    }),
};
