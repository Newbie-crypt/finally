'use client';

import { useEffect, useRef, useState } from 'react';
import { fmtQuantity } from '@/lib/format';
import type { ChatEntry, ChatTrade, WatchlistChange } from '@/lib/types';

interface ChatPanelProps {
  entries: ChatEntry[];
  pending: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSend: (message: string) => void | Promise<void>;
}

/** Inline receipt for a trade the assistant executed on the user's behalf. */
function TradeReceipt({ trade }: { trade: ChatTrade }) {
  const failed = Boolean(trade.error);
  const buy = trade.side === 'buy';

  return (
    <div
      data-testid="chat-trade"
      className={`flex items-center gap-2 rounded border px-2 py-1 font-mono text-tick ${
        failed
          ? 'border-down/40 bg-down/10 text-down'
          : 'border-terminal-edge bg-terminal-void text-slate-300'
      }`}
    >
      <span
        className={`font-semibold uppercase ${failed ? 'text-down' : buy ? 'text-up' : 'text-accent'}`}
      >
        {trade.side}
      </span>
      <span className="tnum">
        {fmtQuantity(trade.quantity)} {trade.ticker}
      </span>
      <span className="ml-auto text-micro uppercase tracking-wider">
        {failed ? trade.error : 'Filled'}
      </span>
    </div>
  );
}

function WatchlistReceipt({ change }: { change: WatchlistChange }) {
  const failed = Boolean(change.error);
  return (
    <div
      data-testid="chat-watchlist-change"
      className={`flex items-center gap-2 rounded border px-2 py-1 font-mono text-tick ${
        failed
          ? 'border-down/40 bg-down/10 text-down'
          : 'border-terminal-edge bg-terminal-void text-slate-300'
      }`}
    >
      <span className="font-semibold uppercase text-primary">Watchlist</span>
      <span>
        {change.action === 'add' ? 'Added' : 'Removed'} {change.ticker}
      </span>
      {failed && <span className="ml-auto text-micro uppercase">{change.error}</span>}
    </div>
  );
}

function Message({ entry }: { entry: ChatEntry }) {
  if (entry.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded rounded-br-none border border-primary/30 bg-primary/10 px-3 py-2 text-[13px] leading-relaxed text-slate-100">
          {entry.content}
        </div>
      </div>
    );
  }

  if (entry.role === 'error') {
    return (
      <div
        data-testid="chat-error"
        role="alert"
        className="rounded border border-down/40 bg-down/10 px-3 py-2 font-mono text-tick text-down"
      >
        {entry.content}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="max-w-[92%] rounded rounded-bl-none border border-terminal-line bg-terminal-panel px-3 py-2 text-[13px] leading-relaxed text-slate-200">
        {entry.content}
      </div>
      {entry.trades?.map((trade, i) => <TradeReceipt key={`t-${i}`} trade={trade} />)}
      {entry.watchlist_changes?.map((change, i) => (
        <WatchlistReceipt key={`w-${i}`} change={change} />
      ))}
    </div>
  );
}

export function ChatPanel({ entries, pending, collapsed, onToggle, onSend }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the newest message in view as the conversation grows.
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [entries, pending]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text || pending) return;
    void onSend(text);
    setDraft('');
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-label="Open AI assistant"
        aria-expanded={false}
        className="flex w-11 shrink-0 flex-col items-center gap-3 rounded border border-terminal-line bg-terminal-rail py-3 text-dim transition-colors hover:border-accent/40 hover:text-accent"
      >
        <span className="text-accent">◆</span>
        <span
          className="font-mono text-micro uppercase tracking-[0.2em]"
          style={{ writingMode: 'vertical-rl' }}
        >
          Assistant
        </span>
      </button>
    );
  }

  return (
    <aside className="flex w-[360px] shrink-0 flex-col rounded border border-terminal-line bg-terminal-rail">
      <header className="flex shrink-0 items-center justify-between border-b border-terminal-line px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-accent">◆</span>
          <h2 className="eyebrow text-slate-300">FinAlly Assistant</h2>
        </div>
        <button
          type="button"
          onClick={onToggle}
          aria-label="Collapse AI assistant"
          aria-expanded
          className="rounded px-1.5 font-mono text-tick text-dim transition-colors hover:text-slate-200"
        >
          ›
        </button>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {entries.length === 0 && !pending && (
          <div className="space-y-3 pt-2">
            <p className="text-[13px] leading-relaxed text-muted">
              Ask about your portfolio, get analysis, or have trades executed for you.
            </p>
            <ul className="space-y-1.5">
              {[
                'How is my portfolio doing?',
                'Buy 10 shares of NVDA',
                'Add PYPL to my watchlist',
                "What's my biggest risk concentration?",
              ].map((prompt) => (
                <li key={prompt}>
                  <button
                    type="button"
                    onClick={() => void onSend(prompt)}
                    className="w-full rounded border border-terminal-line bg-terminal-void px-2.5 py-1.5 text-left font-mono text-tick text-muted transition-colors hover:border-accent/40 hover:text-accent"
                  >
                    {prompt}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {entries.map((entry) => (
          <Message key={entry.id} entry={entry} />
        ))}

        {pending && (
          <div
            data-testid="chat-loading"
            role="status"
            aria-live="polite"
            className="flex items-center gap-2 font-mono text-tick text-dim"
          >
            <span className="flex gap-1" aria-hidden="true">
              <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
              <span
                className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent"
                style={{ animationDelay: '160ms' }}
              />
              <span
                className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent"
                style={{ animationDelay: '320ms' }}
              />
            </span>
            Thinking…
          </div>
        )}
      </div>

      <form onSubmit={submit} className="shrink-0 border-t border-terminal-line p-2.5">
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            Message the assistant
          </label>
          <textarea
            id="chat-input"
            value={draft}
            rows={2}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter sends; Shift+Enter breaks the line.
              if (e.key === 'Enter' && !e.shiftKey) submit(e);
            }}
            placeholder="Ask FinAlly…"
            className="field max-h-28 flex-1 resize-none text-[13px]"
          />
          <button
            type="submit"
            disabled={pending || draft.trim().length === 0}
            className="btn bg-secondary px-3 py-2 text-white hover:bg-secondary/85"
          >
            Send
          </button>
        </div>
      </form>
    </aside>
  );
}
