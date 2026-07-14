'use client';

import { fmtPercent, fmtPrice, fmtSignedPrice, pnlColor } from '@/lib/format';
import type { ConnectionStatus } from '@/lib/types';

interface HeaderProps {
  totalValue: number;
  cash: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  status: ConnectionStatus;
}

const STATUS_COPY: Record<ConnectionStatus, { label: string; dot: string; text: string }> = {
  connected: { label: 'Live', dot: 'bg-up', text: 'text-up' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-accent animate-pulse-dot', text: 'text-accent' },
  disconnected: { label: 'Disconnected', dot: 'bg-down', text: 'text-down' },
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-end">
      <span className="eyebrow">{label}</span>
      <span className="tnum font-mono text-[15px] leading-tight">{children}</span>
    </div>
  );
}

export function Header({
  totalValue,
  cash,
  unrealizedPnl,
  unrealizedPnlPercent,
  status,
}: HeaderProps) {
  const s = STATUS_COPY[status];

  return (
    <header className="flex shrink-0 items-center justify-between gap-4 border-b border-terminal-line bg-terminal-panel px-4 py-2.5">
      <div className="flex items-center gap-3">
        {/* Wordmark: the "AI" carries the accent — the ally in Finance Ally. */}
        <span className="font-mono text-lg font-bold tracking-tight text-slate-100">
          Fin<span className="text-accent">Ally</span>
        </span>
        <span className="hidden border-l border-terminal-edge pl-3 font-mono text-micro uppercase tracking-[0.14em] text-dim sm:block">
          AI Trading Workstation
        </span>
      </div>

      <div className="flex items-center gap-5 sm:gap-7">
        <Stat label="Cash">
          <span className="text-slate-300">{fmtPrice(cash)}</span>
        </Stat>

        <Stat label="Unrealized P&L">
          <span className={pnlColor(unrealizedPnl)}>
            {fmtSignedPrice(unrealizedPnl)}
            <span className="ml-1.5 text-tick opacity-80">
              {fmtPercent(unrealizedPnlPercent)}
            </span>
          </span>
        </Stat>

        <Stat label="Portfolio Value">
          <span className="text-[19px] font-semibold text-slate-50">{fmtPrice(totalValue)}</span>
        </Stat>

        <div
          className="flex items-center gap-2 rounded border border-terminal-line bg-terminal-void px-2.5 py-1.5"
          role="status"
          aria-live="polite"
          data-testid="connection-status"
          data-status={status}
        >
          <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden="true" />
          <span className={`font-mono text-micro uppercase tracking-[0.14em] ${s.text}`}>
            {s.label}
          </span>
        </div>
      </div>
    </header>
  );
}
