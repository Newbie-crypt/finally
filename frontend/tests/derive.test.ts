import { describe, expect, it } from 'vitest';
import { derivePortfolio, priceFor, sessionChangePercent } from '@/lib/derive';
import { fmtPercent, fmtPrice, fmtQuantity, fmtSignedPrice } from '@/lib/format';
import { portfolio, prices, priceUpdate } from './fixtures';

describe('derivePortfolio', () => {
  it('values positions at live prices and totals cash + holdings', () => {
    const d = derivePortfolio(portfolio, prices);

    // AAPL 10 @ 195 = 1950, NVDA 20 @ 120 = 2400 → invested 4350, + 5000 cash.
    expect(d.investedValue).toBeCloseTo(4350, 2);
    expect(d.totalValue).toBeCloseTo(9350, 2);
    expect(d.cash).toBe(5000);
  });

  it('computes unrealized P&L per position and in aggregate', () => {
    const d = derivePortfolio(portfolio, prices);
    const aapl = d.positions.find((p) => p.ticker === 'AAPL')!;
    const nvda = d.positions.find((p) => p.ticker === 'NVDA')!;

    expect(aapl.unrealizedPnl).toBeCloseTo(50, 2); // (195 - 190) * 10
    expect(aapl.unrealizedPnlPercent).toBeCloseTo(2.6316, 3);
    expect(nvda.unrealizedPnl).toBeCloseTo(-200, 2); // (120 - 130) * 20
    expect(nvda.unrealizedPnlPercent).toBeCloseTo(-7.6923, 3);

    // Net: +50 - 200 = -150 on a 4500 cost basis.
    expect(d.unrealizedPnl).toBeCloseTo(-150, 2);
    expect(d.unrealizedPnlPercent).toBeCloseTo(-3.3333, 3);
  });

  it('weights positions by market value and sorts largest first', () => {
    const d = derivePortfolio(portfolio, prices);
    expect(d.positions[0].ticker).toBe('NVDA'); // 2400 > 1950
    expect(d.positions[0].weight).toBeCloseTo(2400 / 4350, 4);
    expect(d.positions.reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(1, 6);
  });

  it('falls back to avg cost when the stream has no price yet', () => {
    const d = derivePortfolio(portfolio, {});
    const aapl = d.positions.find((p) => p.ticker === 'AAPL')!;

    expect(aapl.currentPrice).toBe(190); // avg_cost
    expect(aapl.unrealizedPnl).toBe(0); // no phantom P&L before the first tick
  });

  it('handles an empty portfolio without dividing by zero', () => {
    const d = derivePortfolio({ cash_balance: 10000, positions: [] }, prices);

    expect(d.totalValue).toBe(10000);
    expect(d.unrealizedPnl).toBe(0);
    expect(d.unrealizedPnlPercent).toBe(0);
    expect(d.positions).toEqual([]);
  });

  it('drops fully-closed positions', () => {
    const d = derivePortfolio(
      { cash_balance: 100, positions: [{ ticker: 'AAPL', quantity: 0, avg_cost: 190 }] },
      prices,
    );
    expect(d.positions).toHaveLength(0);
  });

  it('supports fractional share quantities', () => {
    const d = derivePortfolio(
      { cash_balance: 0, positions: [{ ticker: 'AAPL', quantity: 2.5, avg_cost: 100 }] },
      { AAPL: priceUpdate('AAPL', 200) },
    );
    expect(d.positions[0].marketValue).toBeCloseTo(500, 2);
    expect(d.positions[0].unrealizedPnl).toBeCloseTo(250, 2);
  });
});

describe('priceFor', () => {
  it('prefers the live price and ignores a zero price', () => {
    expect(priceFor('AAPL', prices, 1)).toBe(195);
    expect(priceFor('AAPL', { AAPL: priceUpdate('AAPL', 0, 0) }, 42)).toBe(42);
    expect(priceFor('ZZZZ', prices, 42)).toBe(42);
  });
});

describe('sessionChangePercent', () => {
  it('measures change from the first tick of the session', () => {
    expect(sessionChangePercent(100, 105)).toBeCloseTo(5, 6);
    expect(sessionChangePercent(100, 95)).toBeCloseTo(-5, 6);
    expect(sessionChangePercent(100, 100)).toBe(0);
  });

  it('returns 0 before a baseline exists', () => {
    expect(sessionChangePercent(undefined, 105)).toBe(0);
    expect(sessionChangePercent(100, undefined)).toBe(0);
  });
});

describe('formatters', () => {
  it('formats prices, signed values, and percentages', () => {
    expect(fmtPrice(1234.5)).toBe('$1,234.50');
    expect(fmtPrice(undefined)).toBe('—');
    expect(fmtSignedPrice(50)).toBe('+$50.00');
    expect(fmtSignedPrice(-200)).toBe('-$200.00');
    expect(fmtPercent(2.6316)).toBe('+2.63%');
    expect(fmtPercent(-7.6923)).toBe('-7.69%');
    expect(fmtPercent(0)).toBe('0.00%');
  });

  it('keeps whole shares clean and preserves fractional ones', () => {
    expect(fmtQuantity(10)).toBe('10');
    expect(fmtQuantity(2.5)).toBe('2.5');
  });
});
