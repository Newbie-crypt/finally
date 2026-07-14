'use client';

/**
 * Live price stream over SSE (PLAN.md §6).
 *
 * Also accumulates per-ticker price history in memory since page load — this is
 * what feeds the sparklines and the main chart. We deliberately never fetch
 * historical bars: §2 says sparklines "fill in progressively" from the stream.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ConnectionStatus, PriceUpdate } from '@/lib/types';

/** Points retained per ticker (~5 min at a 500ms cadence). */
export const MAX_POINTS = 600;

export interface PricePoint {
  t: number;
  price: number;
}

export interface PriceStreamState {
  prices: Record<string, PriceUpdate>;
  history: Record<string, PricePoint[]>;
  /** First price seen this session, per ticker — the session-change baseline. */
  openPrices: Record<string, number>;
  status: ConnectionStatus;
}

function isPriceUpdate(value: unknown): value is PriceUpdate {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as PriceUpdate).ticker === 'string' &&
    typeof (value as PriceUpdate).price === 'number'
  );
}

/**
 * The backend emits one event containing a map of every tracked ticker
 * (`{"AAPL": {...}, "MSFT": {...}}`). Older drafts of the contract described a
 * single update per event. Accept a map, a bare update, or an array of updates
 * so either server shape streams correctly.
 */
export function parsePriceEvent(raw: string): PriceUpdate[] {
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return [];
  }

  if (Array.isArray(payload)) return payload.filter(isPriceUpdate);
  if (isPriceUpdate(payload)) return [payload];
  if (payload && typeof payload === 'object') {
    return Object.values(payload as Record<string, unknown>).filter(isPriceUpdate);
  }
  return [];
}

export function usePriceStream(): PriceStreamState {
  const [prices, setPrices] = useState<Record<string, PriceUpdate>>({});
  const [history, setHistory] = useState<Record<string, PricePoint[]>>({});
  const [status, setStatus] = useState<ConnectionStatus>('reconnecting');
  const openPrices = useRef<Record<string, number>>({});
  // Guards against a stale "disconnected" timer firing after a successful retry.
  const dropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const ingest = useCallback((updates: PriceUpdate[]) => {
    if (updates.length === 0) return;

    setPrices((prev) => {
      const next = { ...prev };
      for (const u of updates) next[u.ticker] = u;
      return next;
    });

    setHistory((prev) => {
      const next = { ...prev };
      for (const u of updates) {
        if (openPrices.current[u.ticker] === undefined) {
          openPrices.current[u.ticker] = u.price;
        }
        const series = next[u.ticker] ?? [];
        const point = { t: u.timestamp, price: u.price };
        // Ring-buffer the tail so long sessions don't grow without bound.
        next[u.ticker] =
          series.length >= MAX_POINTS
            ? [...series.slice(series.length - MAX_POINTS + 1), point]
            : [...series, point];
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const source = new EventSource(api.streamUrl());

    source.onopen = () => {
      if (dropTimer.current) clearTimeout(dropTimer.current);
      setStatus('connected');
    };

    source.onmessage = (event: MessageEvent<string>) => {
      if (dropTimer.current) clearTimeout(dropTimer.current);
      setStatus('connected');
      ingest(parsePriceEvent(event.data));
    };

    // EventSource retries automatically. Show "reconnecting" immediately, and
    // only escalate to "disconnected" if retries keep failing for a while.
    source.onerror = () => {
      setStatus((current) => (current === 'disconnected' ? current : 'reconnecting'));
      if (dropTimer.current) clearTimeout(dropTimer.current);
      dropTimer.current = setTimeout(() => setStatus('disconnected'), 8000);
    };

    return () => {
      if (dropTimer.current) clearTimeout(dropTimer.current);
      source.close();
    };
  }, [ingest]);

  return { prices, history, openPrices: openPrices.current, status };
}
