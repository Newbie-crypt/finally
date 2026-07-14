'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtPrice } from '@/lib/format';

interface PriceCellProps {
  price: number | undefined;
  className?: string;
}

/** How long the flash stays on screen before it's cleared (PLAN.md §2: ~500ms). */
export const FLASH_MS = 500;

/**
 * A price that flashes green on an uptick and red on a downtick, fading out.
 *
 * The `nonce` in the key restarts the CSS animation when a new tick arrives
 * mid-fade — without it, React reuses the element and consecutive upticks in
 * the same direction wouldn't re-trigger the keyframes.
 */
export function PriceCell({ price, className = '' }: PriceCellProps) {
  const previous = useRef<number | undefined>(undefined);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; nonce: number } | null>(null);
  const nonce = useRef(0);

  useEffect(() => {
    const prev = previous.current;
    previous.current = price;

    // No flash on first paint — only on an actual change.
    if (prev === undefined || price === undefined || price === prev) return;

    nonce.current += 1;
    setFlash({ dir: price > prev ? 'up' : 'down', nonce: nonce.current });

    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [price]);

  const flashClass = flash
    ? flash.dir === 'up'
      ? 'animate-flash-up text-up'
      : 'animate-flash-down text-down'
    : 'text-slate-100';

  return (
    <span
      key={flash?.nonce ?? 'idle'}
      data-testid="price-cell"
      data-flash={flash?.dir ?? 'none'}
      className={`tnum inline-block rounded px-1 font-mono transition-colors duration-500 ${flashClass} ${className}`}
    >
      {fmtPrice(price)}
    </span>
  );
}
