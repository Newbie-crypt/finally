import { expect, test } from '@playwright/test';
import { connectionStatus, openTerminal, watchlistPrice } from './helpers';

/** PLAN.md §12: "SSE resilience: disconnect and verify reconnection." */
test.describe('SSE resilience', () => {
  test('status indicator reports a live connection', async ({ page }) => {
    await openTerminal(page);

    const status = connectionStatus(page);
    await expect(status).toHaveAttribute('data-status', 'connected');
    await expect(status).toContainText('Live');
  });

  test('a broken stream shows reconnecting, and EventSource retries back to live', async ({
    page,
  }) => {
    // Playwright's context.setOffline() does not tear down an already-established
    // SSE socket, so the disconnect is simulated at the route layer: the stream is
    // blocked before load, then unblocked — EventSource's built-in retry (PLAN.md
    // §6/§10) has to bring the terminal back on its own, with no page reload.
    await page.route('**/api/stream/prices', (route) => route.abort());

    await page.goto('/');

    // The UI must never claim to be live while the stream is down.
    await expect(connectionStatus(page)).toHaveAttribute(
      'data-status',
      /reconnecting|disconnected/,
      { timeout: 20_000 },
    );
    // The rest of the terminal still works off REST (watchlist loaded, no crash).
    await expect(page.getByTestId('watchlist-row-AAPL')).toBeVisible();

    // Heal the network. No reload — the browser's own retry must do the work.
    await page.unroute('**/api/stream/prices');

    await expect(connectionStatus(page)).toHaveAttribute('data-status', 'connected', {
      timeout: 45_000,
    });
    await expect(connectionStatus(page)).toContainText('Live');

    // And prices are genuinely flowing again, not just a green dot.
    const price = watchlistPrice(page, 'AAPL');
    await expect(price).not.toHaveText('—', { timeout: 20_000 });
    const first = await price.textContent();
    await expect
      .poll(async () => price.textContent(), {
        timeout: 25_000,
        intervals: [250, 250, 500],
        message: 'prices should resume ticking after the stream reconnects',
      })
      .not.toBe(first);
  });

  test('the SSE endpoint streams price events', async ({ page }) => {
    // Protocol-level check, independent of the React layer.
    await page.goto('/');

    const events = await page.evaluate<string[]>(
      () =>
        new Promise((resolve, reject) => {
          const source = new EventSource('/api/stream/prices');
          const received: string[] = [];
          const done = (err?: string) => {
            source.close();
            if (err) reject(new Error(err));
            else resolve(received);
          };
          source.onmessage = (e) => {
            received.push(e.data);
            if (received.length >= 3) done();
          };
          source.onerror = () => done('EventSource errored');
          setTimeout(() => done(received.length ? undefined : 'no events in 15s'), 15_000);
        }),
    );

    expect(events.length).toBeGreaterThanOrEqual(2);

    const payload = JSON.parse(events[0]);
    const updates = Array.isArray(payload) ? payload : Object.values(payload);
    const aapl = (updates as { ticker: string; price: number; direction: string }[]).find(
      (u) => u.ticker === 'AAPL',
    );
    expect(aapl).toBeTruthy();
    expect(aapl!.price).toBeGreaterThan(0);
    expect(['up', 'down', 'flat']).toContain(aapl!.direction);

    // Consecutive events carry fresh data — the cache is actually advancing.
    expect(events[0]).not.toBe(events[events.length - 1]);
  });
});
