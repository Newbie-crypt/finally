'use client';

import { useState } from 'react';
import { Panel } from './Panel';
import { PriceCell } from './PriceCell';
import { Sparkline } from './Sparkline';
import type { PricePoint } from '@/hooks/usePriceStream';
import { sessionChangePercent } from '@/lib/derive';
import { fmtPercent, pnlColor } from '@/lib/format';
import type { PriceUpdate, WatchlistEntry } from '@/lib/types';

interface WatchlistProps {
  entries: WatchlistEntry[];
  prices: Record<string, PriceUpdate>;
  history: Record<string, PricePoint[]>;
  openPrices: Record<string, number>;
  selected: string | null;
  onSelect: (ticker: string) => void;
  onAdd: (ticker: string) => void | Promise<unknown>;
  onRemove: (ticker: string) => void | Promise<unknown>;
}

export function WatchlistPanel({
  entries,
  prices,
  history,
  openPrices,
  selected,
  onSelect,
  onAdd,
  onRemove,
}: WatchlistProps) {
  const [draft, setDraft] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = draft.trim().toUpperCase();
    if (!ticker) return;
    void onAdd(ticker);
    setDraft('');
  };

  return (
    <Panel
      title="Watchlist"
      aside={
        <form onSubmit={submit} className="flex items-center gap-1.5">
          <label htmlFor="watchlist-add" className="sr-only">
            Add ticker to watchlist
          </label>
          <input
            id="watchlist-add"
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            placeholder="ADD TICKER"
            maxLength={8}
            className="field w-28 py-1 text-tick uppercase"
          />
          <button
            type="submit"
            className="btn bg-terminal-edge px-2 py-1.5 text-slate-200 hover:bg-primary hover:text-white"
          >
            Add
          </button>
        </form>
      }
    >
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-terminal-deep">
          <tr className="border-b border-terminal-line text-left">
            <th className="eyebrow px-3 py-1.5 font-normal">Symbol</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Last</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Session</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Trend</th>
            <th className="w-8" />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => {
            const live = prices[entry.ticker];
            const price = live?.price ?? entry.price;
            const change = sessionChangePercent(openPrices[entry.ticker], price);
            const isSelected = selected === entry.ticker;

            return (
              <tr
                key={entry.ticker}
                onClick={() => onSelect(entry.ticker)}
                data-testid={`watchlist-row-${entry.ticker}`}
                data-selected={isSelected}
                className={`group cursor-pointer border-b border-terminal-line/60 transition-colors ${
                  isSelected ? 'bg-accent/10' : 'hover:bg-terminal-panel'
                }`}
              >
                <td className="px-3 py-1.5">
                  <span
                    className={`font-mono text-data font-semibold ${
                      isSelected ? 'text-accent' : 'text-slate-200'
                    }`}
                  >
                    {entry.ticker}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right text-data">
                  <PriceCell price={price} />
                </td>
                <td
                  className={`tnum px-3 py-1.5 text-right font-mono text-data ${pnlColor(change)}`}
                >
                  {fmtPercent(change)}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex justify-end">
                    <Sparkline points={history[entry.ticker] ?? []} trend={change} />
                  </div>
                </td>
                <td className="pr-2">
                  <button
                    type="button"
                    aria-label={`Remove ${entry.ticker} from watchlist`}
                    onClick={(e) => {
                      e.stopPropagation();
                      void onRemove(entry.ticker);
                    }}
                    className="rounded px-1 text-dim opacity-0 transition hover:text-down focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}

          {entries.length === 0 && (
            <tr>
              <td colSpan={5} className="px-3 py-6 text-center font-mono text-tick text-dim">
                No tickers yet. Add one to start streaming prices.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}
