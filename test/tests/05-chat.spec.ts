import { expect, test } from '@playwright/test';
import {
  headerCash,
  openTerminal,
  positionRow,
  sendChat,
  watchlistRow,
} from './helpers';

/**
 * PLAN.md §12: "AI chat (mocked): send a message, receive a response, trade
 * execution appears inline."
 *
 * Runs with LLM_MOCK=true — deterministic regex rules, every reply prefixed
 * "[MOCK]" (see backend/app/llm.py::mock_response).
 */
test.describe.configure({ mode: 'serial' });

test.describe('AI chat (LLM_MOCK)', () => {
  test('answers a plain question with no side effects', async ({ page }) => {
    await openTerminal(page);

    await sendChat(page, 'How is my portfolio doing?');

    const reply = page.getByText(/^\[MOCK\] FinAlly mock assistant\./);
    await expect(reply).toBeVisible();
    await expect(reply).toContainText(/Cash \$[\d,]+\.\d{2}/);
    await expect(page.getByTestId('chat-trade')).toHaveCount(0);
    await expect(page.getByTestId('chat-watchlist-change')).toHaveCount(0);
  });

  test('executes a trade and shows the fill inline', async ({ page, request }) => {
    await openTerminal(page);
    const cashBefore = await headerCash(page);

    await sendChat(page, 'buy 10 AAPL');

    await expect(page.getByText('[MOCK] Order routed: buy 10 AAPL.')).toBeVisible();

    const receipt = page.getByTestId('chat-trade').last();
    await expect(receipt).toBeVisible();
    await expect(receipt).toContainText('buy');
    await expect(receipt).toContainText('10 AAPL');
    await expect(receipt).toContainText('Filled');

    // The trade really executed: position + cash + backend state all agree.
    await expect(positionRow(page, 'AAPL')).toBeVisible();
    await expect(positionRow(page, 'AAPL').locator('td').nth(1)).toHaveText('10');
    expect(await headerCash(page)).toBeLessThan(cashBefore);

    const portfolio = await (await request.get('/api/portfolio')).json();
    expect(
      portfolio.positions.find((p: { ticker: string }) => p.ticker === 'AAPL').quantity,
    ).toBe(10);
  });

  test('surfaces a rejected trade instead of faking a fill', async ({ page }) => {
    await openTerminal(page);
    const cashBefore = await headerCash(page);

    await sendChat(page, 'buy 1000 AAPL');

    const receipt = page.getByTestId('chat-trade').last();
    await expect(receipt).toContainText(/insufficient cash/i);
    await expect(receipt).not.toContainText('Filled');

    // Nothing was bought — the 10 shares from the previous test are untouched.
    await expect(positionRow(page, 'AAPL').locator('td').nth(1)).toHaveText('10');
    expect(await headerCash(page)).toBeCloseTo(cashBefore, 1);
  });

  test('adds and removes a watchlist ticker on request', async ({ page }) => {
    await openTerminal(page);
    await expect(watchlistRow(page, 'PYPL')).toHaveCount(0);

    await sendChat(page, 'add PYPL to my watchlist');
    await expect(page.getByText('[MOCK] Watchlist update: add PYPL.')).toBeVisible();
    await expect(page.getByTestId('chat-watchlist-change').last()).toContainText('Added PYPL');
    await expect(watchlistRow(page, 'PYPL')).toBeVisible();

    await sendChat(page, 'remove PYPL from my watchlist');
    await expect(page.getByTestId('chat-watchlist-change').last()).toContainText('Removed PYPL');
    await expect(watchlistRow(page, 'PYPL')).toHaveCount(0);
  });

  test('conversation history survives a reload (GET /api/chat)', async ({ page }) => {
    await openTerminal(page);

    // Both turns of the trade exchange are still on screen after a fresh load.
    await expect(page.getByText('buy 10 AAPL', { exact: true })).toBeVisible();
    await expect(page.getByText('[MOCK] Order routed: buy 10 AAPL.')).toBeVisible();
    // ...and the executed action was persisted alongside the message.
    await expect(page.getByTestId('chat-trade').first()).toContainText('10 AAPL');

    // Clean up the position this file created.
    await page.locator('#trade-symbol').fill('AAPL');
    await page.locator('#trade-qty').fill('10');
    await page.getByRole('button', { name: 'Sell', exact: true }).click();
    await expect(positionRow(page, 'AAPL')).toHaveCount(0);
  });
});
