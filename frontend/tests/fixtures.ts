/** Shared sample data, shaped exactly like the real API responses (PLAN.md §8). */

import type { Portfolio, PriceUpdate, Snapshot, WatchlistEntry } from '@/lib/types';

export function priceUpdate(ticker: string, price: number, previous = price): PriceUpdate {
  const change = Number((price - previous).toFixed(4));
  return {
    ticker,
    price,
    previous_price: previous,
    timestamp: 1_752_500_000,
    change,
    change_percent: previous ? Number(((change / previous) * 100).toFixed(4)) : 0,
    direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
  };
}

export const prices: Record<string, PriceUpdate> = {
  AAPL: priceUpdate('AAPL', 195.0, 194.0),
  NVDA: priceUpdate('NVDA', 120.0, 121.0),
  MSFT: priceUpdate('MSFT', 424.1, 424.1),
};

export const portfolio: Portfolio = {
  cash_balance: 5000,
  positions: [
    { ticker: 'AAPL', quantity: 10, avg_cost: 190.0 }, // +$50  (+2.63%)
    { ticker: 'NVDA', quantity: 20, avg_cost: 130.0 }, // -$200 (-7.69%)
  ],
};

export const watchlist: WatchlistEntry[] = [
  { ticker: 'AAPL', price: 195.0 },
  { ticker: 'NVDA', price: 120.0 },
  { ticker: 'MSFT', price: 424.1 },
];

export const snapshots: Snapshot[] = [
  { total_value: 10000, recorded_at: '2026-07-14T14:00:00Z' },
  { total_value: 10120, recorded_at: '2026-07-14T14:00:30Z' },
  { total_value: 9950, recorded_at: '2026-07-14T14:01:00Z' },
];
