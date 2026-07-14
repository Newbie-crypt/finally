'use client';

import { useMemo } from 'react';
import type { PricePoint } from '@/hooks/usePriceStream';

interface SparklineProps {
  points: PricePoint[];
  /** Drives the stroke color: up = green, down = red. */
  trend: number;
  width?: number;
  height?: number;
}

/**
 * Hand-rolled SVG sparkline. A charting library per watchlist row would mount
 * ~10 chart instances re-rendering at 2Hz; a memoized path string is far
 * cheaper and this shape needs no axes, tooltips, or legend.
 */
export function Sparkline({ points, trend, width = 72, height = 22 }: SparklineProps) {
  const path = useMemo(() => {
    if (points.length < 2) return '';

    const values = points.map((p) => p.price);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1; // flat line → centered, not divided by zero
    const stepX = width / (points.length - 1);
    const pad = 1.5; // keep the stroke inside the viewBox

    return values
      .map((value, i) => {
        const x = i * stepX;
        const y = height - pad - ((value - min) / span) * (height - pad * 2);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [points, width, height]);

  const stroke = trend > 0 ? '#26d07c' : trend < 0 ? '#f0506e' : '#7d8899';

  // Before ~2 ticks arrive there's nothing to plot. Hold the row's height with a
  // baseline rule so the watchlist doesn't reflow as sparklines fill in.
  if (!path) {
    return (
      <svg width={width} height={height} aria-hidden="true" className="opacity-40">
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="#2e3949"
          strokeWidth="1"
          strokeDasharray="2 3"
        />
      </svg>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="Price sparkline"
      data-testid="sparkline"
    >
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.25" strokeLinejoin="round" />
    </svg>
  );
}
