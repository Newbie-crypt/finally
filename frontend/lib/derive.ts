/**
 * Portfolio math derived on the client from stored positions + live SSE prices.
 *
 * Why derive instead of trusting the API response: /api/portfolio is fetched on
 * load and after trades, but prices tick every ~500ms. Recomputing against the
 * live price cache keeps P&L, weights, and total value moving in real time
 * between fetches. `avg_cost`, `quantity` and `cash_balance` are authoritative
 * from the backend; everything below is a view over them.
 */

import type { Portfolio, Position, PriceUpdate } from './types';

export interface DerivedPosition extends Position {
  currentPrice: number;
  marketValue: number;
  costBasis: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  /** Share of total invested market value, 0–1. */
  weight: number;
}

export interface DerivedPortfolio {
  cash: number;
  positions: DerivedPosition[];
  /** Market value of holdings only, excluding cash. */
  investedValue: number;
  /** Cash + holdings. This is the number in the header. */
  totalValue: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
}

/** Latest price for a ticker, falling back to avg cost when the stream is cold. */
export function priceFor(
  ticker: string,
  prices: Record<string, PriceUpdate>,
  fallback: number,
): number {
  const live = prices[ticker]?.price;
  return typeof live === 'number' && live > 0 ? live : fallback;
}

export function derivePortfolio(
  portfolio: Portfolio | null,
  prices: Record<string, PriceUpdate>,
): DerivedPortfolio {
  const cash = portfolio?.cash_balance ?? 0;
  const raw = portfolio?.positions ?? [];

  const priced = raw
    .filter((p) => p.quantity !== 0)
    .map((p) => {
      const currentPrice = priceFor(p.ticker, prices, p.current_price ?? p.avg_cost);
      const marketValue = currentPrice * p.quantity;
      const costBasis = p.avg_cost * p.quantity;
      const unrealizedPnl = marketValue - costBasis;
      const unrealizedPnlPercent = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;
      return { ...p, currentPrice, marketValue, costBasis, unrealizedPnl, unrealizedPnlPercent };
    });

  const investedValue = priced.reduce((sum, p) => sum + p.marketValue, 0);
  const costTotal = priced.reduce((sum, p) => sum + p.costBasis, 0);
  const unrealizedPnl = investedValue - costTotal;

  const positions: DerivedPosition[] = priced
    .map((p) => ({
      ...p,
      weight: investedValue === 0 ? 0 : p.marketValue / investedValue,
    }))
    .sort((a, b) => b.marketValue - a.marketValue);

  return {
    cash,
    positions,
    investedValue,
    totalValue: cash + investedValue,
    unrealizedPnl,
    unrealizedPnlPercent: costTotal === 0 ? 0 : (unrealizedPnl / costTotal) * 100,
  };
}

/**
 * Percent change since the first price we saw this session.
 *
 * PLAN.md §10 asks for "daily change %" in the watchlist, but the SSE stream
 * only carries tick-over-tick change and there's no historical-quote endpoint
 * (§8). Session change — measured from the first tick after page load — is the
 * honest thing we can compute, and it's what the progressively-filling
 * sparkline shows too, so the two agree.
 */
export function sessionChangePercent(first: number | undefined, current: number | undefined): number {
  if (!first || !current) return 0;
  return ((current - first) / first) * 100;
}
