'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChatPanel } from '@/components/ChatPanel';
import { Header } from '@/components/Header';
import { MainChart } from '@/components/MainChart';
import { PnlChart } from '@/components/PnlChart';
import { PortfolioHeatmap } from '@/components/PortfolioHeatmap';
import { PositionsTable } from '@/components/PositionsTable';
import { TradeBar } from '@/components/TradeBar';
import { WatchlistPanel } from '@/components/Watchlist';
import { usePriceStream } from '@/hooks/usePriceStream';
import { useTerminal } from '@/hooks/useTerminal';
import { derivePortfolio } from '@/lib/derive';

export default function Terminal() {
  const { prices, history: priceHistory, openPrices, status } = usePriceStream();
  const {
    portfolio,
    history,
    watchlist,
    chat,
    chatPending,
    tradeError,
    lastFill,
    clearTradeError,
    executeTrade,
    addTicker,
    removeTicker,
    sendChat,
  } = useTerminal();

  const [selected, setSelected] = useState<string | null>(null);
  const [chatCollapsed, setChatCollapsed] = useState(false);

  // Land on the first watched ticker so the chart is never empty on arrival.
  useEffect(() => {
    if (!selected && watchlist.length > 0) setSelected(watchlist[0].ticker);
  }, [selected, watchlist]);

  const derived = useMemo(() => derivePortfolio(portfolio, prices), [portfolio, prices]);

  return (
    <main className="flex h-screen flex-col overflow-hidden">
      <Header
        totalValue={derived.totalValue}
        cash={derived.cash}
        unrealizedPnl={derived.unrealizedPnl}
        unrealizedPnlPercent={derived.unrealizedPnlPercent}
        status={status}
      />

      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {/* Left rail: what the user is watching. */}
        <div className="flex w-[340px] shrink-0 flex-col">
          <WatchlistPanel
            entries={watchlist}
            prices={prices}
            history={priceHistory}
            openPrices={openPrices}
            selected={selected}
            onSelect={setSelected}
            onAdd={addTicker}
            onRemove={removeTicker}
          />
        </div>

        {/* Center: price action on top, holdings below, trade bar pinned at the base. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="min-h-0 flex-[3]">
            <MainChart
              ticker={selected}
              points={selected ? (priceHistory[selected] ?? []) : []}
              price={selected ? prices[selected] : undefined}
              openPrice={selected ? openPrices[selected] : undefined}
            />
          </div>

          <div className="grid min-h-0 flex-[2] grid-cols-1 gap-2 lg:grid-cols-2">
            <PortfolioHeatmap positions={derived.positions} onSelect={setSelected} />
            <PnlChart snapshots={history} liveValue={derived.totalValue} />
          </div>

          <div className="min-h-0 flex-[2]">
            <PositionsTable
              positions={derived.positions}
              selected={selected}
              onSelect={setSelected}
            />
          </div>

          <TradeBar
            ticker={selected}
            prices={prices}
            onTrade={executeTrade}
            error={tradeError}
            lastFill={lastFill}
            onDismissError={clearTradeError}
          />
        </div>

        {/* Right rail: the copilot. */}
        <ChatPanel
          entries={chat}
          pending={chatPending}
          collapsed={chatCollapsed}
          onToggle={() => setChatCollapsed((c) => !c)}
          onSend={sendChat}
        />
      </div>
    </main>
  );
}
