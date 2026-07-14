'use client';

import { useMemo } from 'react';
import { ResponsiveContainer, Treemap } from 'recharts';
import { Panel } from './Panel';
import type { DerivedPosition } from '@/lib/derive';
import { fmtPercent, fmtPrice } from '@/lib/format';

interface HeatmapProps {
  positions: DerivedPosition[];
  onSelect: (ticker: string) => void;
}

interface CellDatum {
  name: string;
  size: number;
  pnl: number;
  pnlPercent: number;
  weight: number;
}

/**
 * Diverging green↔red scale keyed on P&L percent, saturating at ±5%.
 *
 * Intensity is capped so one runaway winner doesn't wash out every other tile
 * into a flat gray — the reader needs to compare tiles, not just find the max.
 */
function pnlFill(pnlPercent: number): string {
  const t = Math.min(Math.abs(pnlPercent) / 5, 1);
  const alpha = 0.16 + t * 0.62;
  if (pnlPercent > 0.001) return `rgba(38, 208, 124, ${alpha})`;
  if (pnlPercent < -0.001) return `rgba(240, 80, 110, ${alpha})`;
  return 'rgba(125, 136, 153, 0.18)';
}

interface CellProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  pnlPercent?: number;
  weight?: number;
  onSelect?: (ticker: string) => void;
}

function HeatmapCell({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  name = '',
  pnlPercent = 0,
  weight = 0,
  onSelect,
}: CellProps) {
  // Recharts renders a root node for the whole tree; skip anything unnamed.
  if (!name || width <= 0 || height <= 0) return null;

  const showTicker = width > 44 && height > 26;
  const showDetail = width > 64 && height > 46;

  return (
    <g
      onClick={() => onSelect?.(name)}
      className="cursor-pointer"
      data-testid={`heatmap-cell-${name}`}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={pnlFill(pnlPercent)}
        stroke="#0d1117"
        strokeWidth={2}
        rx={2}
      />
      {showTicker && (
        <text
          x={x + 7}
          y={y + 17}
          fill="#e8edf4"
          fontFamily="var(--font-mono)"
          fontSize={12}
          fontWeight={600}
        >
          {name}
        </text>
      )}
      {showDetail && (
        <>
          <text
            x={x + 7}
            y={y + 33}
            fill={pnlPercent >= 0 ? '#26d07c' : '#f0506e'}
            fontFamily="var(--font-mono)"
            fontSize={11}
          >
            {fmtPercent(pnlPercent)}
          </text>
          <text x={x + 7} y={y + 47} fill="#8b98ab" fontFamily="var(--font-mono)" fontSize={10}>
            {(weight * 100).toFixed(1)}%
          </text>
        </>
      )}
    </g>
  );
}

export function PortfolioHeatmap({ positions, onSelect }: HeatmapProps) {
  const data = useMemo<CellDatum[]>(
    () =>
      positions.map((p) => ({
        name: p.ticker,
        // Tile area = market value, so size reads as portfolio weight.
        size: Math.max(p.marketValue, 0.01),
        pnl: p.unrealizedPnl,
        pnlPercent: p.unrealizedPnlPercent,
        weight: p.weight,
      })),
    [positions],
  );

  const winners = positions.filter((p) => p.unrealizedPnl > 0).length;

  return (
    <Panel
      title="Allocation"
      aside={
        positions.length > 0 && (
          <span className="font-mono text-micro uppercase tracking-[0.14em] text-dim">
            <span className="text-up">{winners}</span> up ·{' '}
            <span className="text-down">{positions.length - winners}</span> down
          </span>
        )
      }
      className="min-h-[180px]"
    >
      {data.length === 0 ? (
        <div className="flex h-full min-h-[150px] items-center justify-center px-4 text-center font-mono text-tick text-dim">
          No positions. Buy something to see your allocation.
        </div>
      ) : (
        <div className="h-full min-h-[150px] w-full p-2" data-testid="heatmap">
          <ResponsiveContainer width="100%" height="100%">
            <Treemap
              data={data}
              dataKey="size"
              stroke="#0d1117"
              isAnimationActive={false}
              content={<HeatmapCell onSelect={onSelect} />}
            />
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}

/** Exported for unit tests — the color rule is the whole point of the heatmap. */
export const __test__ = { pnlFill, fmtPrice };
