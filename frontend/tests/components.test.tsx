import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatPanel } from '@/components/ChatPanel';
import { Header } from '@/components/Header';
import { PortfolioHeatmap, __test__ } from '@/components/PortfolioHeatmap';
import { PositionsTable } from '@/components/PositionsTable';
import { PriceCell } from '@/components/PriceCell';
import { Sparkline } from '@/components/Sparkline';
import { TradeBar } from '@/components/TradeBar';
import { WatchlistPanel } from '@/components/Watchlist';
import { derivePortfolio } from '@/lib/derive';
import type { ChatEntry } from '@/lib/types';
import { portfolio, prices, watchlist } from './fixtures';

const derived = derivePortfolio(portfolio, prices);
const noop = () => {};

describe('PriceCell — flash animation', () => {
  it('does not flash on first render', () => {
    render(<PriceCell price={195} />);
    expect(screen.getByTestId('price-cell')).toHaveAttribute('data-flash', 'none');
  });

  it('flashes green on an uptick', async () => {
    const { rerender } = render(<PriceCell price={195} />);
    rerender(<PriceCell price={196} />);

    await waitFor(() => {
      const cell = screen.getByTestId('price-cell');
      expect(cell).toHaveAttribute('data-flash', 'up');
      expect(cell.className).toContain('animate-flash-up');
    });
  });

  it('flashes red on a downtick', async () => {
    const { rerender } = render(<PriceCell price={195} />);
    rerender(<PriceCell price={194} />);

    await waitFor(() => {
      const cell = screen.getByTestId('price-cell');
      expect(cell).toHaveAttribute('data-flash', 'down');
      expect(cell.className).toContain('animate-flash-down');
    });
  });

  it('does not flash when the price is unchanged', async () => {
    const { rerender } = render(<PriceCell price={195} />);
    rerender(<PriceCell price={195} />);
    expect(screen.getByTestId('price-cell')).toHaveAttribute('data-flash', 'none');
  });

  it('clears the flash after the fade window', async () => {
    vi.useFakeTimers();
    try {
      const { rerender } = render(<PriceCell price={195} />);
      rerender(<PriceCell price={196} />);
      expect(screen.getByTestId('price-cell')).toHaveAttribute('data-flash', 'up');

      // act() so React commits the setFlash(null) the expiring timer schedules.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(600);
      });
      expect(screen.getByTestId('price-cell')).toHaveAttribute('data-flash', 'none');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the formatted price', () => {
    render(<PriceCell price={1234.5} />);
    expect(screen.getByTestId('price-cell')).toHaveTextContent('$1,234.50');
  });
});

describe('Header', () => {
  it('renders live value, cash, and P&L', () => {
    render(
      <Header
        totalValue={9350}
        cash={5000}
        unrealizedPnl={-150}
        unrealizedPnlPercent={-3.3333}
        status="connected"
      />,
    );

    expect(screen.getByText('$9,350.00')).toBeInTheDocument();
    expect(screen.getByText('$5,000.00')).toBeInTheDocument();
    expect(screen.getByText('-$150.00')).toBeInTheDocument();
    expect(screen.getByText('-3.33%')).toBeInTheDocument();
  });

  it.each([
    ['connected', 'Live'],
    ['reconnecting', 'Reconnecting'],
    ['disconnected', 'Disconnected'],
  ] as const)('shows the %s connection state', (status, label) => {
    render(
      <Header
        totalValue={1}
        cash={1}
        unrealizedPnl={0}
        unrealizedPnlPercent={0}
        status={status}
      />,
    );

    const indicator = screen.getByTestId('connection-status');
    expect(indicator).toHaveAttribute('data-status', status);
    expect(indicator).toHaveTextContent(label);
  });
});

describe('Watchlist — rendering and CRUD', () => {
  const baseProps = {
    entries: watchlist,
    prices,
    history: {},
    openPrices: { AAPL: 190, NVDA: 125, MSFT: 424.1 },
    selected: 'AAPL',
    onSelect: noop,
    onAdd: noop,
    onRemove: noop,
  };

  it('renders every watched ticker with its live price', () => {
    render(<WatchlistPanel {...baseProps} />);

    for (const ticker of ['AAPL', 'NVDA', 'MSFT']) {
      expect(screen.getByTestId(`watchlist-row-${ticker}`)).toBeInTheDocument();
    }
    expect(within(screen.getByTestId('watchlist-row-AAPL')).getByText('$195.00')).toBeInTheDocument();
  });

  it('shows session change measured from the first price of the session', () => {
    render(<WatchlistPanel {...baseProps} />);

    // AAPL: 190 → 195 = +2.63%. NVDA: 125 → 120 = -4.00%.
    expect(within(screen.getByTestId('watchlist-row-AAPL')).getByText('+2.63%')).toBeInTheDocument();
    expect(within(screen.getByTestId('watchlist-row-NVDA')).getByText('-4.00%')).toBeInTheDocument();
  });

  it('marks the selected row and selects on click', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<WatchlistPanel {...baseProps} onSelect={onSelect} />);

    expect(screen.getByTestId('watchlist-row-AAPL')).toHaveAttribute('data-selected', 'true');
    await user.click(screen.getByTestId('watchlist-row-NVDA'));
    expect(onSelect).toHaveBeenCalledWith('NVDA');
  });

  it('adds a ticker, uppercasing the input', async () => {
    const onAdd = vi.fn();
    const user = userEvent.setup();
    render(<WatchlistPanel {...baseProps} onAdd={onAdd} />);

    await user.type(screen.getByLabelText('Add ticker to watchlist'), 'pypl');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(onAdd).toHaveBeenCalledWith('PYPL');
  });

  it('removes a ticker without also selecting the row', async () => {
    const onRemove = vi.fn();
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<WatchlistPanel {...baseProps} onRemove={onRemove} onSelect={onSelect} />);

    await user.click(screen.getByRole('button', { name: 'Remove NVDA from watchlist' }));

    expect(onRemove).toHaveBeenCalledWith('NVDA');
    expect(onSelect).not.toHaveBeenCalled(); // click must not bubble to the row
  });

  it('invites the user to add a ticker when the list is empty', () => {
    render(<WatchlistPanel {...baseProps} entries={[]} />);
    expect(screen.getByText(/No tickers yet/i)).toBeInTheDocument();
  });
});

describe('Sparkline', () => {
  it('draws a path once at least two points have streamed in', () => {
    const points = [
      { t: 1, price: 100 },
      { t: 2, price: 102 },
      { t: 3, price: 101 },
    ];
    render(<Sparkline points={points} trend={1} />);

    const svg = screen.getByTestId('sparkline');
    expect(svg.querySelector('path')).toHaveAttribute('stroke', '#26d07c');
  });

  it('holds a placeholder before enough points exist', () => {
    render(<Sparkline points={[{ t: 1, price: 100 }]} trend={0} />);
    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument();
  });

  it('survives a flat series without dividing by zero', () => {
    const flat = [
      { t: 1, price: 100 },
      { t: 2, price: 100 },
    ];
    render(<Sparkline points={flat} trend={0} />);
    expect(screen.getByTestId('sparkline').querySelector('path')?.getAttribute('d')).not.toContain(
      'NaN',
    );
  });
});

describe('PositionsTable', () => {
  it('renders each position with quantity, cost, value, and P&L', () => {
    render(<PositionsTable positions={derived.positions} selected="AAPL" onSelect={noop} />);

    const aapl = within(screen.getByTestId('position-row-AAPL'));
    expect(aapl.getByText('10')).toBeInTheDocument();
    expect(aapl.getByText('$190.00')).toBeInTheDocument(); // avg cost
    expect(aapl.getByText('$1,950.00')).toBeInTheDocument(); // market value
    expect(aapl.getByText('+$50.00')).toBeInTheDocument();
    expect(aapl.getByText('+2.63%')).toBeInTheDocument();

    const nvda = within(screen.getByTestId('position-row-NVDA'));
    expect(nvda.getByText('-$200.00')).toBeInTheDocument();
    expect(nvda.getByText('-7.69%')).toBeInTheDocument();
  });

  it('colors gains green and losses red', () => {
    render(<PositionsTable positions={derived.positions} selected={null} onSelect={noop} />);

    expect(within(screen.getByTestId('position-row-AAPL')).getByText('+$50.00').className).toContain(
      'text-up',
    );
    expect(
      within(screen.getByTestId('position-row-NVDA')).getByText('-$200.00').className,
    ).toContain('text-down');
  });

  it('prompts the user when there are no positions', () => {
    render(<PositionsTable positions={[]} selected={null} onSelect={noop} />);
    expect(screen.getByText(/No open positions/i)).toBeInTheDocument();
  });
});

describe('PortfolioHeatmap', () => {
  it('colors tiles green for profit and red for loss, scaled by magnitude', () => {
    const { pnlFill } = __test__;

    expect(pnlFill(3)).toContain('rgba(38, 208, 124');
    expect(pnlFill(-3)).toContain('rgba(240, 80, 110');
    expect(pnlFill(0)).toContain('rgba(125, 136, 153');

    // A bigger gain is a stronger green.
    const alpha = (fill: string) => Number(fill.match(/,\s*([\d.]+)\)$/)![1]);
    expect(alpha(pnlFill(5))).toBeGreaterThan(alpha(pnlFill(1)));
    // …but intensity saturates so outliers can't wash out the rest.
    expect(alpha(pnlFill(50))).toBe(alpha(pnlFill(5)));
  });

  it('renders a tile per position', () => {
    render(<PortfolioHeatmap positions={derived.positions} onSelect={noop} />);
    expect(screen.getByTestId('heatmap')).toBeInTheDocument();
  });

  it('explains itself when there are no positions', () => {
    render(<PortfolioHeatmap positions={[]} onSelect={noop} />);
    expect(screen.getByText(/No positions/i)).toBeInTheDocument();
  });
});

describe('TradeBar', () => {
  const baseProps = {
    ticker: 'AAPL',
    prices,
    onTrade: vi.fn().mockResolvedValue(true),
    error: null,
    lastFill: null,
    onDismissError: noop,
  };

  it('prefills the symbol from the selected ticker and shows the live price', () => {
    render(<TradeBar {...baseProps} />);
    expect(screen.getByLabelText('Ticker')).toHaveValue('AAPL');
    // At the default quantity of 1, last price and estimated notional are both
    // $195.00 — the bar shows the figure twice, once per label.
    expect(screen.getAllByText('$195.00')).toHaveLength(2);
  });

  it('recomputes the estimated notional as the quantity changes', async () => {
    const user = userEvent.setup();
    render(<TradeBar {...baseProps} />);

    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '3');

    // 3 × $195.00 = $585.00
    expect(screen.getByText('$585.00')).toBeInTheDocument();
  });

  it('submits a buy at the entered quantity', async () => {
    const onTrade = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<TradeBar {...baseProps} onTrade={onTrade} />);

    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: 'Buy' }));

    expect(onTrade).toHaveBeenCalledWith('AAPL', 5, 'buy');
  });

  it('submits a sell', async () => {
    const onTrade = vi.fn().mockResolvedValue(true);
    const user = userEvent.setup();
    render(<TradeBar {...baseProps} onTrade={onTrade} />);

    await user.click(screen.getByRole('button', { name: 'Sell' }));
    expect(onTrade).toHaveBeenCalledWith('AAPL', 1, 'sell');
  });

  it('disables trading on a non-positive or unparseable quantity', async () => {
    const user = userEvent.setup();
    render(<TradeBar {...baseProps} />);

    const qty = screen.getByLabelText('Quantity');
    await user.clear(qty);
    await user.type(qty, '0');

    expect(screen.getByRole('button', { name: 'Buy' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sell' })).toBeDisabled();
  });

  it('surfaces a rejected trade', () => {
    render(<TradeBar {...baseProps} error="Insufficient cash: need $2,000.00" />);
    expect(screen.getByTestId('trade-error')).toHaveTextContent('Insufficient cash');
  });

  it('confirms a fill', () => {
    render(<TradeBar {...baseProps} lastFill="Bought 5 AAPL" />);
    expect(screen.getByTestId('trade-fill')).toHaveTextContent('Bought 5 AAPL');
  });
});

describe('ChatPanel', () => {
  const baseProps = {
    entries: [] as ChatEntry[],
    pending: false,
    collapsed: false,
    onToggle: noop,
    onSend: noop,
  };

  it('renders user and assistant messages', () => {
    const entries: ChatEntry[] = [
      { id: '1', role: 'user', content: 'How is my portfolio doing?' },
      { id: '2', role: 'assistant', content: 'You are down 3.3% on the day.' },
    ];
    render(<ChatPanel {...baseProps} entries={entries} />);

    expect(screen.getByText('How is my portfolio doing?')).toBeInTheDocument();
    expect(screen.getByText('You are down 3.3% on the day.')).toBeInTheDocument();
  });

  it('shows executed trades inline as confirmations', () => {
    const entries: ChatEntry[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'Bought 10 NVDA.',
        trades: [{ ticker: 'NVDA', side: 'buy', quantity: 10 }],
        watchlist_changes: [{ ticker: 'PYPL', action: 'add' }],
      },
    ];
    render(<ChatPanel {...baseProps} entries={entries} />);

    const trade = screen.getByTestId('chat-trade');
    expect(trade).toHaveTextContent('buy');
    expect(trade).toHaveTextContent('10 NVDA');
    expect(trade).toHaveTextContent('Filled');
    expect(screen.getByTestId('chat-watchlist-change')).toHaveTextContent('Added PYPL');
  });

  it('shows a rejected trade with its reason', () => {
    const entries: ChatEntry[] = [
      {
        id: '1',
        role: 'assistant',
        content: 'That order did not go through.',
        trades: [
          { ticker: 'NVDA', side: 'buy', quantity: 1000, error: 'Insufficient cash' },
        ],
      },
    ];
    render(<ChatPanel {...baseProps} entries={entries} />);
    expect(screen.getByTestId('chat-trade')).toHaveTextContent('Insufficient cash');
  });

  it('renders an LLM failure as an error, not an assistant reply', () => {
    const entries: ChatEntry[] = [
      { id: '1', role: 'error', content: 'Something went wrong. Try again.' },
    ];
    render(<ChatPanel {...baseProps} entries={entries} />);

    const error = screen.getByTestId('chat-error');
    expect(error).toHaveTextContent('Something went wrong. Try again.');
    expect(error).toHaveAttribute('role', 'alert');
  });

  it('shows a loading indicator while awaiting a response', () => {
    render(<ChatPanel {...baseProps} pending />);
    expect(screen.getByTestId('chat-loading')).toHaveTextContent('Thinking…');
  });

  it('sends a message and clears the input', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel {...baseProps} onSend={onSend} />);

    const input = screen.getByLabelText('Message the assistant');
    await user.type(input, 'Buy 10 NVDA');
    await user.click(screen.getByRole('button', { name: 'Send' }));

    expect(onSend).toHaveBeenCalledWith('Buy 10 NVDA');
    expect(input).toHaveValue('');
  });

  it('will not send while a response is pending', async () => {
    const onSend = vi.fn();
    render(<ChatPanel {...baseProps} pending entries={[{ id: '1', role: 'user', content: 'hi' }]} />);

    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('collapses to a rail that can be reopened', async () => {
    const onToggle = vi.fn();
    const user = userEvent.setup();
    render(<ChatPanel {...baseProps} collapsed onToggle={onToggle} />);

    await user.click(screen.getByRole('button', { name: 'Open AI assistant' }));
    expect(onToggle).toHaveBeenCalled();
  });
});
