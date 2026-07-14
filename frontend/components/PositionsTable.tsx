'use client';

import { Panel } from './Panel';
import { PriceCell } from './PriceCell';
import type { DerivedPosition } from '@/lib/derive';
import { fmtPercent, fmtPrice, fmtQuantity, fmtSignedPrice, pnlColor } from '@/lib/format';

interface PositionsTableProps {
  positions: DerivedPosition[];
  onSelect: (ticker: string) => void;
  selected: string | null;
}

export function PositionsTable({ positions, onSelect, selected }: PositionsTableProps) {
  return (
    <Panel
      title="Positions"
      aside={
        <span className="font-mono text-micro uppercase tracking-[0.14em] text-dim">
          {positions.length} open
        </span>
      }
    >
      <table className="w-full border-collapse">
        <thead className="sticky top-0 z-10 bg-terminal-deep">
          <tr className="border-b border-terminal-line text-left">
            <th className="eyebrow px-3 py-1.5 font-normal">Symbol</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Qty</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Avg Cost</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Last</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Value</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">Unrealized</th>
            <th className="eyebrow px-3 py-1.5 text-right font-normal">%</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => (
            <tr
              key={p.ticker}
              onClick={() => onSelect(p.ticker)}
              data-testid={`position-row-${p.ticker}`}
              className={`cursor-pointer border-b border-terminal-line/60 transition-colors ${
                selected === p.ticker ? 'bg-accent/10' : 'hover:bg-terminal-panel'
              }`}
            >
              <td className="px-3 py-1.5 font-mono text-data font-semibold text-slate-200">
                {p.ticker}
              </td>
              <td className="tnum px-3 py-1.5 text-right font-mono text-data text-slate-300">
                {fmtQuantity(p.quantity)}
              </td>
              <td className="tnum px-3 py-1.5 text-right font-mono text-data text-slate-400">
                {fmtPrice(p.avg_cost)}
              </td>
              <td className="px-3 py-1.5 text-right text-data">
                <PriceCell price={p.currentPrice} />
              </td>
              <td className="tnum px-3 py-1.5 text-right font-mono text-data text-slate-300">
                {fmtPrice(p.marketValue)}
              </td>
              <td
                className={`tnum px-3 py-1.5 text-right font-mono text-data ${pnlColor(p.unrealizedPnl)}`}
              >
                {fmtSignedPrice(p.unrealizedPnl)}
              </td>
              <td
                className={`tnum px-3 py-1.5 text-right font-mono text-data ${pnlColor(p.unrealizedPnl)}`}
              >
                {fmtPercent(p.unrealizedPnlPercent)}
              </td>
            </tr>
          ))}

          {positions.length === 0 && (
            <tr>
              <td colSpan={7} className="px-3 py-6 text-center font-mono text-tick text-dim">
                No open positions. Use the trade bar below to buy your first.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}
