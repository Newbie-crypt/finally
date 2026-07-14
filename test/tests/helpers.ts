import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

/** The seeded watchlist (PLAN.md §7 "Default Seed Data"). */
export const DEFAULT_TICKERS = [
  'AAPL',
  'GOOGL',
  'MSFT',
  'AMZN',
  'TSLA',
  'NVDA',
  'META',
  'JPM',
  'V',
  'NFLX',
];

export const STARTING_CASH = 10_000;

// ---------------------------------------------------------------------------
// Locators (mirroring the data-testids the frontend already exposes)
// ---------------------------------------------------------------------------

/** A header stat by its label: "Cash", "Unrealized P&L", "Portfolio Value". */
export function headerStat(page: Page, label: string): Locator {
  return page
    .locator('header div.flex.flex-col')
    .filter({ hasText: label })
    .locator('.tnum')
    .first();
}

export const watchlistRow = (page: Page, ticker: string): Locator =>
  page.getByTestId(`watchlist-row-${ticker}`);

export const positionRow = (page: Page, ticker: string): Locator =>
  page.getByTestId(`position-row-${ticker}`);

export const connectionStatus = (page: Page): Locator => page.getByTestId('connection-status');

/** Last-price cell of a watchlist row. */
export const watchlistPrice = (page: Page, ticker: string): Locator =>
  watchlistRow(page, ticker).getByTestId('price-cell');

/** Session-change cell (3rd column) of a watchlist row. */
export const watchlistSessionChange = (page: Page, ticker: string): Locator =>
  watchlistRow(page, ticker).locator('td').nth(2);

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** "$9,812.40" / "+$12.30" / "-$4.00" -> number. Throws on "—". */
export function money(text: string | null): number {
  if (!text) throw new Error('expected a money string, got empty');
  const cleaned = text.replace(/[$,\s]/g, '');
  const value = Number(cleaned);
  if (Number.isNaN(value)) throw new Error(`not a money string: ${text}`);
  return value;
}

/** Cash balance as read from the header. */
export async function headerCash(page: Page): Promise<number> {
  return money(await headerStat(page, 'Cash').textContent());
}

// ---------------------------------------------------------------------------
// API helpers (setup/teardown that doesn't need to go through the UI)
// ---------------------------------------------------------------------------

export interface Portfolio {
  cash_balance: number;
  positions: { ticker: string; quantity: number; avg_cost: number }[];
}

export const getPortfolio = async (request: APIRequestContext): Promise<Portfolio> => {
  const res = await request.get('/api/portfolio');
  expect(res.ok()).toBeTruthy();
  return res.json();
};

export const apiTrade = async (
  request: APIRequestContext,
  ticker: string,
  quantity: number,
  side: 'buy' | 'sell',
) => {
  const res = await request.post('/api/portfolio/trade', { data: { ticker, quantity, side } });
  expect(res.ok(), `trade ${side} ${quantity} ${ticker} failed: ${await res.text()}`).toBeTruthy();
  return res.json();
};

// ---------------------------------------------------------------------------
// Waiting on the live terminal
// ---------------------------------------------------------------------------

/** Resolves once the SSE stream is up and the first prices have painted. */
export async function waitForStream(page: Page, ticker = 'AAPL'): Promise<void> {
  await expect(connectionStatus(page)).toHaveAttribute('data-status', 'connected', {
    timeout: 20_000,
  });
  await expect(watchlistPrice(page, ticker)).not.toHaveText('—', { timeout: 20_000 });
}

/** Loads the terminal and waits for it to be live. */
export async function openTerminal(page: Page): Promise<void> {
  await page.goto('/');
  await waitForStream(page);
}

/**
 * Sends a chat message through the UI and waits for the assistant's reply to land.
 *
 * Waits on the response rather than the "Thinking…" indicator: in mock mode the
 * round-trip can finish before Playwright ever sees the indicator appear.
 */
export async function sendChat(page: Page, message: string): Promise<void> {
  const response = page.waitForResponse(
    (r) => r.url().includes('/api/chat') && r.request().method() === 'POST',
    { timeout: 30_000 },
  );
  await page.locator('#chat-input').fill(message);
  await page.getByRole('button', { name: 'Send' }).click();
  await response;
  await expect(page.getByTestId('chat-loading')).toBeHidden({ timeout: 30_000 });
}

/** Assistant message bubbles, in order (excludes user bubbles and error rows). */
export const assistantMessages = (page: Page): Locator =>
  page.locator('aside').getByText('[MOCK]', { exact: false });
