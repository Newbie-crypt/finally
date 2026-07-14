'use client';

import { useMemo } from 'react';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Panel } from './Panel';
import { fmtPrice } from '@/lib/format';
import type { Snapshot } from '@/lib/types';

interface PnlChartProps {
  snapshots: Snapshot[];
  /** Live total value, appended as the trailing point so the line stays current. */
  liveValue: number;
}

export function PnlChart({ snapshots, liveValue }: PnlChartProps) {
  const data = useMemo(() => {
    const rows = snapshots.map((s) => ({
      value: s.total_value,
      label: new Date(s.recorded_at).toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
      }),
    }));
    // Snapshots land every 30s; pin the current value on the end so the chart
    // doesn't visibly lag the header.
    if (liveValue > 0) rows.push({ value: liveValue, label: 'now' });
    return rows;
  }, [snapshots, liveValue]);

  const domain = useMemo<[number, number] | undefined>(() => {
    if (data.length < 2) return undefined;
    const values = data.map((d) => d.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = (max - min || max * 0.005) * 0.2;
    return [min - pad, max + pad];
  }, [data]);

  return (
    <Panel title="Portfolio Value" className="min-h-[150px]">
      {data.length < 2 ? (
        <div className="flex h-full min-h-[120px] items-center justify-center px-4 text-center font-mono text-tick text-dim">
          Value is snapshotted every 30 seconds. The curve appears shortly.
        </div>
      ) : (
        <div className="h-full min-h-[120px] w-full p-2" data-testid="pnl-chart">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke="#232b38" strokeDasharray="2 4" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#5d6b7f', fontSize: 10, fontFamily: 'var(--font-mono)' }}
                axisLine={{ stroke: '#232b38' }}
                tickLine={false}
                minTickGap={40}
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
                formatter={(value: number) => [fmtPrice(value), 'Total value']}
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke="#209dd7"
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
