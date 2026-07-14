import { expect, test } from '@playwright/test';
import { openTerminal, watchlistPrice, watchlistRow } from './helpers';

/** PLAN.md §12: "Add and remove a ticker from the watchlist." */
test.describe.configure({ mode: 'serial' });

test.describe('watchlist CRUD', () => {
  const TICKER = 'PYPL'; // not in the default seed

  test('adds a ticker, which then streams a live price', async ({ page }) => {
    await openTerminal(page);
    await expect(watchlistRow(page, TICKER)).toHaveCount(0);

    await page.locator('#watchlist-add').fill(TICKER.toLowerCase()); // input upper-cases
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    await expect(watchlistRow(page, TICKER)).toBeVisible();
    // The simulator seeds an unknown ticker with a plausible price (§6).
    await expect(watchlistPrice(page, TICKER)).not.toHaveText('—', { timeout: 20_000 });

    // Persisted server-side, not just optimistic UI.
    const watchlist = await (await page.request.get('/api/watchlist')).json();
    const tickers = (Array.isArray(watchlist) ? watchlist : watchlist.watchlist).map(
      (w: { ticker: string }) => w.ticker,
    );
    expect(tickers).toContain(TICKER);
  });

  test('removes a ticker', async ({ page }) => {
    await openTerminal(page);
    const row = watchlistRow(page, TICKER);
    await expect(row).toBeVisible();

    await row.hover();
    await row.getByRole('button', { name: `Remove ${TICKER} from watchlist` }).click();

    await expect(row).toHaveCount(0);

    await page.reload();
    await expect(watchlistRow(page, TICKER)).toHaveCount(0);
  });

  test('clicking a ticker selects it into the chart and the trade bar', async ({ page }) => {
    await openTerminal(page);
    await watchlistRow(page, 'NVDA').click();

    await expect(watchlistRow(page, 'NVDA')).toHaveAttribute('data-selected', 'true');
    await expect(page.locator('#trade-symbol')).toHaveValue('NVDA');
    await expect(page.getByTestId('main-chart')).toBeVisible();
  });
});
