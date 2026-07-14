'use client';

import { useEffect, useState } from 'react';
import { fmtPrice } from '@/lib/format';
import type { PriceUpdate, Side } from '@/lib/types';

interface TradeBarProps {
  /** Selected watchlist ticker — prefills the symbol field. */
  ticker: string | null;
  prices: Record<string, PriceUpdate>;
  onTrade: (ticker: string, quantity: number, side: Side) => Promise<boolean>;
  error: string | null;
  lastFill: string | null;
  onDismissError: () => void;
}

export function TradeBar({
  ticker,
  prices,
  onTrade,
  error,
  lastFill,
  onDismissError,
}: TradeBarProps) {
  const [symbol, setSymbol] = useState(ticker ?? '');
  const [quantity, setQuantity] = useState('1');
  const [busy, setBusy] = useState(false);

  // Clicking a ticker anywhere in the terminal loads it into the trade bar.
  useEffect(() => {
    if (ticker) setSymbol(ticker);
  }, [ticker]);

  const qty = Number.parseFloat(quantity);
  const validQty = Number.isFinite(qty) && qty > 0;
  const validSymbol = symbol.trim().length > 0;
  const price = prices[symbol.trim().toUpperCase()]?.price;
  const notional = validQty && price ? price * qty : null;

  const submit = async (side: Side) => {
    if (!validSymbol || !validQty || busy) return;
    setBusy(true);
    // Market order, instant fill, no confirmation dialog (PLAN.md §2).
    await onTrade(symbol.trim().toUpperCase(), qty, side);
    setBusy(false);
  };

  return (
    <div className="shrink-0 rounded border border-terminal-line bg-terminal-deep/90">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <span className="eyebrow mr-1">Market Order</span>

        <label htmlFor="trade-symbol" className="sr-only">
          Ticker
        </label>
        <input
          id="trade-symbol"
          value={symbol}
          onChange={(e) => {
            setSymbol(e.target.value.toUpperCase());
            onDismissError();
          }}
          placeholder="SYMBOL"
          maxLength={8}
          className="field w-28 uppercase"
        />

        <label htmlFor="trade-qty" className="sr-only">
          Quantity
        </label>
        <input
          id="trade-qty"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            onDismissError();
          }}
          inputMode="decimal"
          placeholder="QTY"
          className="field tnum w-24"
        />

        <button
          type="button"
          onClick={() => void submit('buy')}
          disabled={!validSymbol || !validQty || busy}
          className="btn bg-primary px-4 py-1.5 text-white hover:bg-primary/85"
        >
          Buy
        </button>
        <button
          type="button"
          onClick={() => void submit('sell')}
          disabled={!validSymbol || !validQty || busy}
          className="btn bg-secondary px-4 py-1.5 text-white hover:bg-secondary/85"
        >
          Sell
        </button>

        <span className="tnum ml-1 font-mono text-tick text-dim">
          {price ? (
            <>
              Last <span className="text-slate-300">{fmtPrice(price)}</span>
              {notional !== null && (
                <>
                  {' · '}Est. <span className="text-slate-300">{fmtPrice(notional)}</span>
                </>
              )}
            </>
          ) : validSymbol ? (
            'No live price yet — the order fills at the next tick.'
          ) : null}
        </span>

        <div className="ml-auto font-mono text-tick" role="status" aria-live="polite">
          {error ? (
            <span className="text-down" data-testid="trade-error">
              {error}
            </span>
          ) : lastFill ? (
            <span className="text-up" data-testid="trade-fill">
              Filled · {lastFill}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
