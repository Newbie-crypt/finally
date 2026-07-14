import { expect, test } from '@playwright/test';
import { apiTrade, openTerminal, positionRow } from './helpers';

/**
 * PLAN.md §12: "Portfolio visualization: heatmap renders with correct colors,
 * P&L chart has data points."
 *
 * The positions are seeded through the API (the UI path is already covered by
 * 03-trading) so this file can focus on what the charts actually render.
 */
test.describe.configure({ mode: 'serial' });

test.describe('portfolio visualization', () => {
  test.beforeAll(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    await apiTrade(request, 'AAPL', 4, 'buy');
    await apiTrade(request, 'TSLA', 6, 'buy');
    await request.dispose();
  });

  test.afterAll(async ({ playwright, baseURL }) => {
    const request = await playwright.request.newContext({ baseURL });
    await apiTrade(request, 'AAPL', 4, 'sell');
    await apiTrade(request, 'TSLA', 6, 'sell');
    await request.dispose();
  });

  test('heatmap renders one cell per position, colored by P&L', async ({ page }) => {
    await openTerminal(page);
    await expect(positionRow(page, 'AAPL')).toBeVisible();

    const heatmap = page.getByTestId('heatmap');
    await expect(heatmap).toBeVisible();

    for (const ticker of ['AAPL', 'TSLA']) {
      const cell = page.getByTestId(`heatmap-cell-${ticker}`);
      await expect(cell).toBeVisible();

      const rect = cell.locator('rect').first();
      const fill = await rect.getAttribute('fill');
      // Diverging scale (PortfolioHeatmap.pnlFill): green up, red down, gray flat.
      expect(fill, `${ticker} tile fill`).toMatch(
        /^rgba\((38, 208, 124|240, 80, 110|125, 136, 153)/,
      );

      // Tiles are sized by market value — a real, non-degenerate rectangle.
      const box = await rect.boundingBox();
      expect(box!.width).toBeGreaterThan(1);
      expect(box!.height).toBeGreaterThan(1);
    }

    // TSLA (6 shares, higher notional) should own more area than AAPL (4 shares).
    const areaOf = async (t: string) => {
      const b = await page.getByTestId(`heatmap-cell-${t}`).locator('rect').first().boundingBox();
      return b!.width * b!.height;
    };
    expect(await areaOf('TSLA')).toBeGreaterThan(await areaOf('AAPL'));

    // The color must agree with the sign of the P&L the positions table reports.
    const pnlText = await positionRow(page, 'AAPL').locator('td').nth(5).innerText();
    const fill = await page.getByTestId('heatmap-cell-AAPL').locator('rect').first().getAttribute('fill');
    if (pnlText.startsWith('+')) expect(fill).toContain('38, 208, 124');
    else if (pnlText.startsWith('-')) expect(fill).toContain('240, 80, 110');
  });

  test('P&L chart plots the portfolio value series', async ({ page }) => {
    // A snapshot is written on every trade (§7), so the series already has points.
    await openTerminal(page);

    const chart = page.getByTestId('pnl-chart');
    await expect(chart).toBeVisible({ timeout: 20_000 });

    // Recharts draws the series as a single path; it must have real geometry
    // (a move-to plus at least one line/curve segment => >= 2 plotted points).
    const curve = chart.locator('.recharts-line-curve').first();
    await expect(curve).toBeVisible();
    const d = await curve.getAttribute('d');
    expect(d).toMatch(/^M[\d.,\s-]+[CLQ]/);

    // Axes are labelled with real dollar values, not the empty-state copy.
    await expect(chart.locator('.recharts-yAxis .recharts-cartesian-axis-tick').first()).toHaveText(
      /\$[\d,]+/,
    );
    await expect(page.getByText('Value is snapshotted every 30 seconds.')).toHaveCount(0);

    // And the underlying data really is there (a snapshot is written per trade, §7).
    const history = await (await page.request.get('/api/portfolio/history')).json();
    const rows = Array.isArray(history) ? history : history.snapshots ?? history.history;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('total_value');
    expect(rows[0]).toHaveProperty('recorded_at');
  });

  test('positions table shows quantity, avg cost, live price and P&L', async ({ page }) => {
    await openTerminal(page);
    const row = positionRow(page, 'TSLA');
    await expect(row).toBeVisible();
    await expect(row.locator('td').nth(1)).toHaveText('6');
    await expect(row.locator('td').nth(2)).toHaveText(/^\$[\d,]+\.\d{2}$/); // avg cost
    await expect(row.getByTestId('price-cell')).not.toHaveText('—'); // live price
    await expect(row.locator('td').nth(5)).toHaveText(/^[+-]?\$[\d,]+\.\d{2}$/); // unrealized
    await expect(row.locator('td').nth(6)).toHaveText(/^[+-]?\d+\.\d{2}%$/); // %
  });
});
