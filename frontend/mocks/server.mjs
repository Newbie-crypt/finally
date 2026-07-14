/**
 * Standalone mock of the FinAlly API — a development convenience only.
 *
 * It lets you run the UI (prices streaming, trades filling, chat replying)
 * before the real backend exists. The app itself has zero knowledge of this
 * file: it always calls the real paths from PLAN.md §8, and this server just
 * answers them.
 *
 *   npm run mock-api          # serves http://localhost:8000
 *   NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev
 *
 * No dependencies — plain node:http.
 */

import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT ?? 8000);

const SEED = {
  AAPL: 190.2, GOOGL: 175.4, MSFT: 424.1, AMZN: 183.6, TSLA: 248.5,
  NVDA: 126.3, META: 512.8, JPM: 205.7, V: 279.4, NFLX: 678.9,
};

const state = {
  cash: 10000,
  positions: [
    { ticker: 'AAPL', quantity: 12, avg_cost: 186.4 },
    { ticker: 'NVDA', quantity: 20, avg_cost: 131.05 },
    { ticker: 'MSFT', quantity: 4, avg_cost: 430.2 },
  ],
  watchlist: Object.keys(SEED),
  chat: [],
  snapshots: [],
};

const prices = new Map();
for (const [ticker, price] of Object.entries(SEED)) {
  prices.set(ticker, { price, previous: price });
}

function seedFor(ticker) {
  return SEED[ticker] ?? 20 + Math.random() * 380;
}

// Geometric-Brownian-ish random walk, mirroring the real simulator's cadence.
setInterval(() => {
  for (const ticker of state.watchlist) {
    if (!prices.has(ticker)) {
      const seed = seedFor(ticker);
      prices.set(ticker, { price: seed, previous: seed });
    }
    const entry = prices.get(ticker);
    const shock = Math.random() < 0.002 ? (Math.random() - 0.5) * 0.06 : 0;
    const drift = (Math.random() - 0.5) * 0.004 + shock;
    const next = Math.max(0.5, entry.price * (1 + drift));
    prices.set(ticker, { price: Number(next.toFixed(2)), previous: entry.price });
  }
}, 500);

const priceOf = (ticker) => prices.get(ticker)?.price ?? seedFor(ticker);

function totalValue() {
  const invested = state.positions.reduce((sum, p) => sum + priceOf(p.ticker) * p.quantity, 0);
  return state.cash + invested;
}

// Portfolio snapshots every 30s, as PLAN.md §7 specifies.
state.snapshots.push({ total_value: totalValue(), recorded_at: new Date().toISOString() });
setInterval(() => {
  state.snapshots.push({ total_value: totalValue(), recorded_at: new Date().toISOString() });
  if (state.snapshots.length > 200) state.snapshots.shift();
}, 30_000);

function priceMap() {
  const out = {};
  for (const ticker of state.watchlist) {
    const entry = prices.get(ticker);
    if (!entry) continue;
    const change = Number((entry.price - entry.previous).toFixed(4));
    out[ticker] = {
      ticker,
      price: entry.price,
      previous_price: entry.previous,
      timestamp: Date.now() / 1000,
      change,
      change_percent: entry.previous
        ? Number(((change / entry.previous) * 100).toFixed(4))
        : 0,
      direction: change > 0 ? 'up' : change < 0 ? 'down' : 'flat',
    };
  }
  return out;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function executeTrade({ ticker, quantity, side }) {
  const symbol = String(ticker || '').toUpperCase();
  const qty = Number(quantity);
  if (!symbol || !Number.isFinite(qty) || qty <= 0) throw new Error('Invalid trade request');

  const price = priceOf(symbol);
  const existing = state.positions.find((p) => p.ticker === symbol);

  if (side === 'buy') {
    const cost = price * qty;
    if (cost > state.cash) throw new Error(`Insufficient cash: need $${cost.toFixed(2)}`);
    state.cash -= cost;
    if (existing) {
      const totalQty = existing.quantity + qty;
      existing.avg_cost = (existing.avg_cost * existing.quantity + cost) / totalQty;
      existing.quantity = totalQty;
    } else {
      state.positions.push({ ticker: symbol, quantity: qty, avg_cost: price });
    }
  } else {
    if (!existing || existing.quantity < qty) throw new Error(`Insufficient shares of ${symbol}`);
    state.cash += price * qty;
    existing.quantity -= qty;
    if (existing.quantity <= 0.0001) {
      state.positions = state.positions.filter((p) => p.ticker !== symbol);
    }
  }

  // A trade auto-adds the ticker to the watchlist (PLAN.md §8).
  if (!state.watchlist.includes(symbol)) state.watchlist.push(symbol);
  state.snapshots.push({ total_value: totalValue(), recorded_at: new Date().toISOString() });
  return { ticker: symbol, side, quantity: qty, price };
}

/** Deterministic canned assistant, standing in for LLM_MOCK=true. */
function mockChat(message) {
  const text = message.toLowerCase();
  const buy = text.match(/buy\s+([\d.]+)\s+(?:shares?\s+of\s+)?([a-z]{1,5})/i);
  const sell = text.match(/sell\s+([\d.]+)\s+(?:shares?\s+of\s+)?([a-z]{1,5})/i);
  const add = text.match(/add\s+([a-z]{1,5})\s+to\s+(?:my\s+)?watchlist/i);

  const trades = [];
  const watchlist_changes = [];

  for (const [match, side] of [[buy, 'buy'], [sell, 'sell']]) {
    if (!match) continue;
    const quantity = Number(match[1]);
    const ticker = match[2].toUpperCase();
    try {
      executeTrade({ ticker, quantity, side });
      trades.push({ ticker, side, quantity });
    } catch (err) {
      trades.push({ ticker, side, quantity, error: err.message });
    }
  }

  if (add) {
    const ticker = add[1].toUpperCase();
    if (!state.watchlist.includes(ticker)) state.watchlist.push(ticker);
    watchlist_changes.push({ ticker, action: 'add' });
  }

  let reply;
  if (trades.length) {
    const failed = trades.find((t) => t.error);
    reply = failed
      ? `I couldn't place that order: ${failed.error}`
      : `Done. ${trades.map((t) => `${t.side} ${t.quantity} ${t.ticker}`).join(', ')}. Your cash balance is now $${state.cash.toFixed(2)}.`;
  } else if (watchlist_changes.length) {
    reply = `Added ${watchlist_changes.map((c) => c.ticker).join(', ')} to your watchlist. It's streaming live now.`;
  } else {
    const value = totalValue();
    reply = `Your portfolio is worth $${value.toFixed(2)} across ${state.positions.length} positions, with $${state.cash.toFixed(2)} in cash. Your largest holding is ${state.positions[0]?.ticker ?? 'none'}.`;
  }

  return { message: reply, trades, watchlist_changes };
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname.replace(/\/$/, '') || '/';

  if (req.method === 'OPTIONS') return json(res, 204, {});

  if (path === '/api/stream/prices') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 1000\n\n');
    const timer = setInterval(() => {
      res.write(`data: ${JSON.stringify(priceMap())}\n\n`);
    }, 500);
    req.on('close', () => clearInterval(timer));
    return;
  }

  if (path === '/api/health') return json(res, 200, { status: 'ok' });

  if (path === '/api/portfolio' && req.method === 'GET') {
    return json(res, 200, {
      cash_balance: state.cash,
      positions: state.positions.map((p) => ({ ...p, current_price: priceOf(p.ticker) })),
      total_value: totalValue(),
    });
  }

  if (path === '/api/portfolio/history') return json(res, 200, state.snapshots);

  if (path === '/api/portfolio/trade' && req.method === 'POST') {
    const body = await readBody(req);
    try {
      return json(res, 200, executeTrade(body));
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
  }

  if (path === '/api/watchlist' && req.method === 'GET') {
    const live = priceMap();
    return json(
      res,
      200,
      state.watchlist.map((ticker) => live[ticker] ?? { ticker }),
    );
  }

  if (path === '/api/watchlist' && req.method === 'POST') {
    const { ticker } = await readBody(req);
    const symbol = String(ticker || '').toUpperCase();
    if (!symbol) return json(res, 400, { error: 'Ticker required' });
    if (!state.watchlist.includes(symbol)) state.watchlist.push(symbol);
    return json(res, 201, { ticker: symbol });
  }

  if (path.startsWith('/api/watchlist/') && req.method === 'DELETE') {
    const symbol = decodeURIComponent(path.split('/').pop()).toUpperCase();
    state.watchlist = state.watchlist.filter((t) => t !== symbol);
    return json(res, 200, { ticker: symbol });
  }

  if (path === '/api/chat' && req.method === 'GET') return json(res, 200, state.chat);

  if (path === '/api/chat' && req.method === 'POST') {
    const { message } = await readBody(req);
    if (!message) return json(res, 400, { error: 'Message required' });

    const now = new Date().toISOString();
    state.chat.push({ id: randomUUID(), role: 'user', content: message, created_at: now });

    const reply = mockChat(String(message));
    state.chat.push({
      id: randomUUID(),
      role: 'assistant',
      content: reply.message,
      actions: JSON.stringify({
        trades: reply.trades,
        watchlist_changes: reply.watchlist_changes,
      }),
      created_at: now,
    });

    // A touch of latency so the loading indicator is actually visible.
    setTimeout(() => json(res, 200, reply), 400);
    return;
  }

  return json(res, 404, { error: `No route for ${req.method} ${path}` });
}).listen(PORT, () => {
  console.log(`FinAlly mock API on http://localhost:${PORT}`);
  console.log(`Run the UI against it:  NEXT_PUBLIC_API_BASE=http://localhost:${PORT} npm run dev`);
});
