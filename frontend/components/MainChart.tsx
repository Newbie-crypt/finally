'use client';

import { useMemo } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Panel } from './Panel';
import type { PricePoint } from '@/hooks/usePriceStream';
import { sessionChangePercent } from '@/lib/derive';
import { fmtPercent, fmtPrice, fmtTime, pnlColor } from '@/lib/format';
import type { PriceUpdate } from '@/lib/types';

interface MainChartProps {
  ticker: string | null;
  points: PricePoint[];
  price: PriceUpdate | undefined;
  openPrice: number | undefined;
}

export function MainChart({ ticker, points, price, openPrice }: MainChartProps) {
  const data = useMemo(
    () => points.map((p) => ({ ...p, label: fmtTime(p.t) })),
    [points],
  );

  const change = sessionChangePercent(openPrice, price?.price);
  const positive = change >= 0;
  const stroke = positive ? '#26d07c' : '#f0506e';

  // Zoom the y-axis to the traded range — a full 0-based axis flattens
  // intraday moves into a straight line.
  const domain = useMemo<[number, number] | undefined>(() => {
    if (data.length < 2) return undefined;
    const values = data.map((d) => d.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min || max * 0.01) * 0.15;
    return [min - pad, max + pad];
  }, [data]);

  return (
    <Panel
      title={ticker ? `${ticker} — Session` : 'Chart'}
      aside={
        price && (
          <div className="flex items-baseline gap-2">
            <span className="tnum font-mono text-data font-semibold text-slate-100">
              {fmtPrice(price.price)}
            </span>
            <span className={`tnum font-mono text-tick ${pnlColor(change)}`}>
              {fmtPercent(change)}
            </span>
          </div>
        )
      }
      className="min-h-[220px]"
    >
      {!ticker || data.length < 2 ? (
        <div className="flex h-full min-h-[180px] items-center justify-center px-6 text-center font-mono text-tick text-dim">
          {ticker
            ? `Charting ${ticker} — the series builds as prices stream in.`
            : 'Select a ticker in the watchlist to chart it.'}
        </div>
      ) : (
        <div className="h-full min-h-[180px] w-full p-2" data-testid="main-chart">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="mainFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stroke} stopOpacity={0.28} />
                  <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#232b38" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#5d6b7f', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={{ stroke: '#232b38' }}
                tickLine={false}
                minTickGap={48}
              />
              <YAxis
                domain={domain ?? ['auto', 'auto']}
                tick={{ fill: '#5d6b7f', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={false}
                tickLine={false}
                width={58}
                tickFormatter={(v: number) => fmtPrice(v)}
              />
              <Tooltip
                contentStyle={{
                  background: '#11161f',
                  border: '1px solid #2e3949',
                  borderRadius: 4,
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                }}
                labelStyle={{ color: '#8b98ab' }}
                formatter={(value: number) => [fmtPrice(value), 'Price']}
              />
              <Area
                type="monotone"
                dataKey="price"
                stroke={stroke}
                strokeWidth={1.5}
                fill="url(#mainFill)"
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
