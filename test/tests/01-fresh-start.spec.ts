import { expect, test } from '@playwright/test';
import {
  DEFAULT_TICKERS,
  connectionStatus,
  headerCash,
  headerStat,
  openTerminal,
  watchlistPrice,
  watchlistRow,
  watchlistSessionChange,
} from './helpers';

/**
 * PLAN.md §12: "Fresh start: default watchlist appears, $10k balance shown,
 * prices are streaming."
 *
 * This file runs first (alphabetical, single worker) because it is the only one
 * that asserts the pristine $10,000 seed — everything after it spends money.
 */
test.describe('fresh start', () => {
  test('seeds the default watchlist, $10k cash, and a live price stream', async ({ page }) => {
    await page.goto('/');

    // --- Default watchlist (PLAN.md §7 seed data) -----------------------------
    for (const ticker of DEFAULT_TICKERS) {
      await expect(watchlistRow(page, ticker), `${ticker} should be watched`).toBeVisible();
    }
    // Exactly the ten seeded tickers — the API returns them sorted, so compare sets.
    const rendered = await page.locator('[data-testid^="watchlist-row-"]').allInnerTexts();
    expect(rendered).toHaveLength(DEFAULT_TICKERS.length);
    expect(rendered.map((t) => t.trim().split(/\s+/)[0]).sort()).toEqual(
      [...DEFAULT_TICKERS].sort(),
    );

    // --- $10,000 virtual cash, and nothing invested yet ------------------------
    await expect(headerStat(page, 'Cash')).toHaveText('$10,000.00');
    expect(await headerCash(page)).toBe(10_000);
    await expect(page.getByText('No open positions.')).toBeVisible();

    // --- Prices are actually streaming ----------------------------------------
    await expect(connectionStatus(page)).toHaveAttribute('data-status', 'connected', {
      timeout: 20_000,
    });

    const price = watchlistPrice(page, 'AAPL');
    await expect(price).not.toHaveText('—', { timeout: 20_000 });
    const first = await price.textContent();

    // Not just "the page loaded" — the number must move (simulator ticks ~500ms).
    await expect
      .poll(async () => price.textContent(), {
        timeout: 25_000,
        intervals: [250, 250, 500],
        message: 'AAPL price should tick within a few seconds of connecting',
      })
      .not.toBe(first);

    // Total value tracks cash + holdings; with no positions it's still $10k-ish.
    await expect(headerStat(page, 'Portfolio Value')).toHaveText('$10,000.00');
  });

  test('watchlist session change starts flat and then moves with the stream', async ({ page }) => {
    // Documented deviation: the "Session" column is change-since-page-load, not a
    // true daily change — the backend exposes no daily open price. Test the real
    // semantics: flat at load, moving once ticks arrive.
    await openTerminal(page);

    const change = watchlistSessionChange(page, 'AAPL');
    await expect(change).toHaveText(/^[+-]?\d+\.\d{2}%$/);

    await expect
      .poll(async () => change.textContent(), {
        timeout: 25_000,
        intervals: [250, 250, 500],
        message: 'session change should move away from 0.00% as prices tick',
      })
      .not.toBe('0.00%');
  });

  test('health endpoint is green', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.ok()).toBeTruthy();
  });
});
