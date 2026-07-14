# FinAlly — Frontend

The Next.js + TypeScript trading terminal. Builds to a **static export** (`out/`) that
FastAPI serves as static files on the same origin as `/api/*`, so there is no CORS
configuration and no second server in production.

## Commands

```bash
npm install       # install dependencies
npm run dev       # dev server on http://localhost:3000
npm run build     # production static export -> out/
npm test          # unit + component tests (vitest)
npm run test:watch
npm run typecheck # tsc --noEmit
npm run mock-api  # standalone mock backend on :8000 (see below)
```

`npm run build` is the one the Dockerfile runs; its output lands in `out/` and is
copied to `/app/static` in the image.

## Developing without the backend

The backend and frontend are separate origins during development, so point the UI at a
backend with `NEXT_PUBLIC_API_BASE`. Two terminals:

```bash
npm run mock-api                                       # terminal 1 — mock API on :8000
NEXT_PUBLIC_API_BASE=http://localhost:8000 npm run dev # terminal 2 — UI on :3000
```

`mocks/server.mjs` implements the full API contract from PLAN.md §8 — including a live
SSE price stream with simulated ticks — so the terminal is fully exercisable end to end.
Against the **real** backend the variable is simply left unset: every request is relative
(`/api/...`), which is what the single-origin production container serves.

The mock is a dev/test convenience only. No component branches on it — the app always
makes the same `fetch` / `EventSource` calls against the real paths.

## Architecture

```
app/          Next.js App Router — layout + the single terminal page
components/   UI: Header, Watchlist, MainChart, PortfolioHeatmap, PnlChart,
              PositionsTable, TradeBar, ChatPanel, plus PriceCell/Sparkline/Panel
hooks/        usePriceStream (SSE + in-memory price history)
              useTerminal   (REST: portfolio, watchlist, chat)
lib/          api (fetch client), types (wire contract), derive (portfolio math),
              format (display formatters)
mocks/        standalone mock backend
tests/        vitest + React Testing Library
```

### Two hooks, one page

- **`usePriceStream`** owns the `EventSource` on `/api/stream/prices`, the latest-price
  map, the connection status, and per-ticker price history **accumulated since page
  load**. There is no historical-bars endpoint, so sparklines and the main chart fill in
  progressively from the stream, exactly as PLAN.md §2 specifies.
- **`useTerminal`** owns everything read/written over REST.

### Prices are derived, not trusted

`/api/portfolio` is fetched on load and after each trade, but prices tick every ~500ms.
`lib/derive.ts` recomputes market value, P&L, weights, and total value from the
authoritative `quantity`/`avg_cost`/`cash_balance` against the **live** price cache, so
the header and tables keep moving between fetches rather than going stale.

### Session change, not daily change

The SSE stream carries only tick-over-tick change, and there is no historical-quote
endpoint. The watchlist therefore shows **session** change — measured from the first tick
seen after page load — which is the honest number available and agrees with what the
sparkline draws.

## Testing

56 tests across three files:

- `tests/components.test.tsx` — rendering with mock data, the price flash animation
  (up/down/unchanged/fade-out), watchlist CRUD, positions and heatmap rendering,
  trade bar submission and validation, chat rendering, loading state, and the inline
  error state for a failed LLM call.
- `tests/derive.test.ts` — portfolio math: P&L, weights, total value, edge cases.
- `tests/priceStream.test.ts` — SSE event parsing.

jsdom implements neither layout nor scrolling, so `tests/setup.ts` stubs
`ResizeObserver`, element dimensions (Recharts measures its parent), and
`Element.scrollTo`.
