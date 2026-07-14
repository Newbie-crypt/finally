import { expect, test } from '@playwright/test';
import {
  getPortfolio,
  headerCash,
  openTerminal,
  positionRow,
  watchlistRow,
} from './helpers';

/**
 * PLAN.md §12:
 *  - "Buy shares: cash decreases, position appears, portfolio updates"
 *  - "Sell shares: cash increases, position updates or disappears"
 */
test.describe.configure({ mode: 'serial' });

const TICKER = 'MSFT';

async function trade(page: import('@playwright/test').Page, qty: string, side: 'Buy' | 'Sell') {
  await page.locator('#trade-symbol').fill(TICKER);
  await page.locator('#trade-qty').fill(qty);
  await page.getByRole('button', { name: side, exact: true }).click();
  await expect(page.getByTestId('trade-fill')).toBeVisible();
}

test.describe('manual trading', () => {
  test('buy: cash decreases, the position appears, the portfolio updates', async ({
    page,
    request,
  }) => {
    await openTerminal(page);

    const cashBefore = await headerCash(page);
    await expect(positionRow(page, TICKER)).toHaveCount(0);

    await trade(page, '3', 'Buy');

    // Position appears in the table with the right quantity.
    const row = positionRow(page, TICKER);
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(1)).toHaveText('3');

    // Cash decreases by roughly 3 x price (the price ticks, so allow a band).
    const cashAfter = await headerCash(page);
    expect(cashAfter).toBeLessThan(cashBefore);

    const portfolio = await getPortfolio(request);
    const held = portfolio.positions.find((p) => p.ticker === TICKER);
    expect(held?.quantity).toBe(3);
    const spent = cashBefore - cashAfter;
    expect(spent).toBeGreaterThan(0);
    // Cash spent should match qty x avg cost within a cent of rounding.
    expect(Math.abs(spent - 3 * (held?.avg_cost ?? 0))).toBeLessThan(0.05);
    expect(Math.abs(portfolio.cash_balance - cashAfter)).toBeLessThan(0.01);
  });

  test('sell part of a position: cash increases, the position updates', async ({
    page,
    request,
  }) => {
    await openTerminal(page);
    const cashBefore = await headerCash(page);

    await trade(page, '1', 'Sell');

    const row = positionRow(page, TICKER);
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(1)).toHaveText('2');

    expect(await headerCash(page)).toBeGreaterThan(cashBefore);
    const portfolio = await getPortfolio(request);
    expect(portfolio.positions.find((p) => p.ticker === TICKER)?.quantity).toBe(2);
  });

  test('sell the rest: the position disappears', async ({ page, request }) => {
    await openTerminal(page);
    const cashBefore = await headerCash(page);

    await trade(page, '2', 'Sell');

    await expect(positionRow(page, TICKER)).toHaveCount(0);
    expect(await headerCash(page)).toBeGreaterThan(cashBefore);

    const portfolio = await getPortfolio(request);
    expect(portfolio.positions.find((p) => p.ticker === TICKER)).toBeUndefined();
  });

  test('rejects a buy the cash balance cannot cover', async ({ page }) => {
    await openTerminal(page);
    const cashBefore = await headerCash(page);

    await page.locator('#trade-symbol').fill('AAPL');
    await page.locator('#trade-qty').fill('100000');
    await page.getByRole('button', { name: 'Buy', exact: true }).click();

    await expect(page.getByTestId('trade-error')).toContainText(/insufficient cash/i);
    await expect(positionRow(page, 'AAPL')).toHaveCount(0);
    expect(await headerCash(page)).toBeCloseTo(cashBefore, 2);
  });

  test('buying an off-watchlist ticker auto-adds it to the watchlist (§8)', async ({ page }) => {
    await openTerminal(page);
    await expect(watchlistRow(page, 'PYPL')).toHaveCount(0);

    await page.locator('#trade-symbol').fill('PYPL');
    await page.locator('#trade-qty').fill('1');
    await page.getByRole('button', { name: 'Buy', exact: true }).click();
    await expect(page.getByTestId('trade-fill')).toBeVisible();

    await expect(watchlistRow(page, 'PYPL')).toBeVisible();
    await expect(positionRow(page, 'PYPL')).toBeVisible();

    // Clean up so later specs start from a known watchlist. Note that selling out
    // does NOT remove the auto-added ticker from the watchlist (by design — §8
    // only specifies auto-add), so the watchlist entry is deleted explicitly.
    await page.locator('#trade-qty').fill('1');
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    await expect(positionRow(page, 'PYPL')).toHaveCount(0);

    const deleted = await page.request.delete('/api/watchlist/PYPL');
    expect(deleted.ok()).toBeTruthy();
    await page.reload();
    await expect(watchlistRow(page, 'PYPL')).toHaveCount(0);
  });
});
