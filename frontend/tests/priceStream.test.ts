import { describe, expect, it } from 'vitest';
import { parsePriceEvent } from '@/hooks/usePriceStream';

describe('parsePriceEvent', () => {
  const update = {
    ticker: 'AAPL',
    price: 195.0,
    previous_price: 194.0,
    timestamp: 1_752_500_000,
    change: 1.0,
    change_percent: 0.5155,
    direction: 'up' as const,
  };

  it('parses the ticker-keyed map the backend actually sends', () => {
    const raw = JSON.stringify({ AAPL: update, MSFT: { ...update, ticker: 'MSFT', price: 424.1 } });
    const parsed = parsePriceEvent(raw);

    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.ticker).sort()).toEqual(['AAPL', 'MSFT']);
  });

  it('parses a single bare update', () => {
    expect(parsePriceEvent(JSON.stringify(update))).toEqual([update]);
  });

  it('parses an array of updates', () => {
    expect(parsePriceEvent(JSON.stringify([update]))).toEqual([update]);
  });

  it('returns nothing for malformed or empty payloads', () => {
    expect(parsePriceEvent('not json')).toEqual([]);
    expect(parsePriceEvent('null')).toEqual([]);
    expect(parsePriceEvent('{}')).toEqual([]);
    expect(parsePriceEvent(JSON.stringify({ AAPL: { ticker: 'AAPL' } }))).toEqual([]);
  });
});
