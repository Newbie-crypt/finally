# FinAlly E2E Tests

Playwright end-to-end suite for FinAlly (PLAN.md §12). It drives the **real
production container** — the same `Dockerfile` that ships — with the market
simulator and `LLM_MOCK=true`, so runs are fast, free, and deterministic.

## Run it (recommended: containerized)

From the repo root:

```bash
docker compose -f test/docker-compose.test.yml up --build --exit-code-from playwright
docker compose -f test/docker-compose.test.yml down -v      # tidy up
```

The stack is two services:

| Service | What it is |
|---|---|
| `finally` | The app image, built from the root `Dockerfile`. `LLM_MOCK=true`, a dummy `OPENROUTER_API_KEY` (never used in mock mode), no `MASSIVE_API_KEY` → built-in simulator. `/app/db` is a **tmpfs**, so every `up` starts from a freshly seeded database. |
| `playwright` | `mcr.microsoft.com/playwright` image with browsers preinstalled. Browser deps stay out of the production image. |

The stack exits with Playwright's exit code, so CI can gate on it directly.

> The app service is deliberately **not** named `app`: Chromium ships the `.app`
> TLD in its HSTS preload list, so `http://app:8000` gets force-upgraded to
> HTTPS and every navigation dies with `ERR_SSL_PROTOCOL_ERROR`.

## Run it against a local app (faster iteration)

Start FinAlly however you like (`docker compose up`, or uvicorn straight from
`backend/`) with `LLM_MOCK=true` and a **fresh database**, then:

```bash
cd test
npm install
npx playwright install chromium     # first time only
BASE_URL=http://localhost:8000 npx playwright test
BASE_URL=http://localhost:8000 npx playwright test --headed --debug   # to poke at a failure
```

### Fresh database required

The suite runs **serially, one worker**, and shares a single SQLite database and
cash balance. `01-fresh-start` asserts the pristine seed ($10,000 cash, the ten
default tickers), so it must run against a fresh DB — the compose stack
guarantees this with tmpfs. Running the suite twice against the *same*
long-lived database will fail `01`. Delete `db/finally.db` (or `down -v`) first.

Every other spec cleans up after itself (sells what it buys, removes what it
adds), and reads cash before/after rather than assuming a fixed balance.

## What's covered

| File | Scenarios |
|---|---|
| `01-fresh-start.spec.ts` | Seeded 10-ticker watchlist; $10,000 cash and portfolio value; SSE connects and prices *actually move*; session-change column behaves; `/api/health`. |
| `02-watchlist.spec.ts` | Add a ticker (streams a simulator-seeded price, persists server-side), remove it, click-to-select into chart + trade bar. |
| `03-trading.spec.ts` | Buy → cash down, position appears, backend agrees; partial sell → position updates; full sell → position disappears; insufficient-cash rejection; off-watchlist buy auto-adds the ticker (§8). |
| `04-portfolio-viz.spec.ts` | Heatmap: one tile per position, diverging green/red/gray fills that agree with the sign of the reported P&L, area ordered by market value. P&L chart: real plotted curve + `/api/portfolio/history` data. Positions table columns. |
| `05-chat.spec.ts` | `LLM_MOCK` chat: plain Q&A with no side effects; `buy 10 AAPL` → inline "Filled" receipt + real position + cash change; `buy 1000 AAPL` → inline rejection ("insufficient cash"), nothing bought; watchlist add/remove via chat; history survives a reload (`GET /api/chat`). |
| `06-sse-resilience.spec.ts` | Connection indicator reads "Live"; a broken stream shows *reconnecting* (never a false "Live") and EventSource's own retry recovers to live with fresh ticks — no reload; protocol-level check that `/api/stream/prices` emits distinct price events. |

### Notes on two deliberate choices

- **Session change, not daily change.** The watchlist "Session" column is
  change-since-page-load (the backend has no daily open price). Tests assert
  session semantics, not daily.
- **Simulated disconnect.** Playwright's `context.setOffline(true)` does *not*
  tear down an already-open SSE socket, so `06` simulates the outage by aborting
  the `/api/stream/prices` route, then un-aborting it and letting `EventSource`'s
  built-in retry reconnect on its own.

## Housekeeping

`node_modules/`, `test-results/`, `playwright-report/` are gitignored. Keep the
Playwright image tag in `docker-compose.test.yml` in lockstep with
`@playwright/test` in `package.json`.
