'use client';

/**
 * Owns everything the terminal reads and writes over REST: portfolio, history,
 * watchlist, and chat. The price stream is separate (see usePriceStream).
 */

import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type {
  ChatEntry,
  ChatActions,
  ChatMessage,
  Portfolio,
  Side,
  Snapshot,
  WatchlistEntry,
} from '@/lib/types';

let entrySeq = 0;
const nextId = () => `entry-${++entrySeq}`;

/** History rows store actions as a JSON string in SQLite; parse defensively. */
function parseActions(actions: ChatMessage['actions']): ChatActions {
  if (!actions) return {};
  if (typeof actions === 'string') {
    try {
      return JSON.parse(actions) as ChatActions;
    } catch {
      return {};
    }
  }
  return actions;
}

export function useTerminal() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [chatPending, setChatPending] = useState(false);
  const [tradeError, setTradeError] = useState<string | null>(null);
  const [lastFill, setLastFill] = useState<string | null>(null);

  const refreshPortfolio = useCallback(async () => {
    try {
      const [p, h] = await Promise.all([api.getPortfolio(), api.getHistory()]);
      setPortfolio(p);
      setHistory(h);
    } catch {
      /* Stream keeps running; a failed refresh shouldn't blank the terminal. */
    }
  }, []);

  const refreshWatchlist = useCallback(async () => {
    try {
      setWatchlist(await api.getWatchlist());
    } catch {
      /* keep the last known watchlist */
    }
  }, []);

  // Initial load: portfolio, history, watchlist, chat backlog.
  useEffect(() => {
    void refreshPortfolio();
    void refreshWatchlist();
    void (async () => {
      try {
        const messages = await api.getChatHistory();
        setChat(
          messages.map((m) => {
            const actions = parseActions(m.actions);
            return {
              id: m.id ?? nextId(),
              role: m.role,
              content: m.content,
              trades: actions.trades,
              watchlist_changes: actions.watchlist_changes,
            };
          }),
        );
      } catch {
        /* no history yet */
      }
    })();
  }, [refreshPortfolio, refreshWatchlist]);

  // Portfolio snapshots land every 30s (PLAN.md §7); poll the P&L series so the
  // chart advances without a page refresh.
  useEffect(() => {
    const id = setInterval(() => void refreshPortfolio(), 30_000);
    return () => clearInterval(id);
  }, [refreshPortfolio]);

  const executeTrade = useCallback(
    async (ticker: string, quantity: number, side: Side) => {
      setTradeError(null);
      setLastFill(null);
      try {
        await api.trade({ ticker: ticker.toUpperCase(), quantity, side });
        setLastFill(`${side === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${ticker.toUpperCase()}`);
        // A successful trade may auto-add the ticker to the watchlist (§8).
        await Promise.all([refreshPortfolio(), refreshWatchlist()]);
        return true;
      } catch (err) {
        setTradeError(err instanceof ApiError ? err.message : 'Trade failed. Try again.');
        return false;
      }
    },
    [refreshPortfolio, refreshWatchlist],
  );

  const addTicker = useCallback(
    async (ticker: string) => {
      try {
        await api.addTicker(ticker);
        await refreshWatchlist();
        return true;
      } catch {
        return false;
      }
    },
    [refreshWatchlist],
  );

  const removeTicker = useCallback(
    async (ticker: string) => {
      // Optimistic: the row disappears on click, and a failure re-syncs it back.
      setWatchlist((prev) => prev.filter((w) => w.ticker !== ticker));
      try {
        await api.removeTicker(ticker);
      } finally {
        await refreshWatchlist();
      }
    },
    [refreshWatchlist],
  );

  const sendChat = useCallback(
    async (message: string) => {
      const text = message.trim();
      if (!text || chatPending) return;

      setChat((prev) => [...prev, { id: nextId(), role: 'user', content: text }]);
      setChatPending(true);

      try {
        const res = await api.sendChat(text);
        setChat((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'assistant',
            content: res.message,
            trades: res.trades,
            watchlist_changes: res.watchlist_changes,
          },
        ]);
        // The assistant may have traded or edited the watchlist on our behalf.
        if (res.trades?.length || res.watchlist_changes?.length) {
          await Promise.all([refreshPortfolio(), refreshWatchlist()]);
        }
      } catch (err) {
        // §9: a failed LLM call is an error state, never a fake assistant reply.
        setChat((prev) => [
          ...prev,
          {
            id: nextId(),
            role: 'error',
            content:
              err instanceof ApiError && err.message
                ? err.message
                : 'Something went wrong. Try again.',
          },
        ]);
      } finally {
        setChatPending(false);
      }
    },
    [chatPending, refreshPortfolio, refreshWatchlist],
  );

  return {
    portfolio,
    history,
    watchlist,
    chat,
    chatPending,
    tradeError,
    lastFill,
    clearTradeError: () => setTradeError(null),
    executeTrade,
    addTicker,
    removeTicker,
    sendChat,
  };
}
