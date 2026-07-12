# FinAlly Plan Review

**Date:** 2026-07-12  
**Scope:** `planning/PLAN.md`

## Overall Assessment

The plan is coherent, implementation-oriented, and mostly complete. The architecture choices are sensible for the stated goals: one container, one port, static frontend export, FastAPI backend, SQLite persistence, and a source-agnostic market data layer. The document also does a good job of separating product intent from implementation boundaries.

The remaining issues are not structural blockers, but they are the kinds of details that tend to create churn during implementation if they are left implicit.

## Strengths

- Clear single-user product model with a straightforward first-run experience.
- Good separation between market data production, cacheing, streaming, and UI consumption.
- Sensible defaulting to the simulator, with real market data treated as an opt-in path.
- Testability is explicitly considered through `LLM_MOCK=true`.
- The API surface is compact and maps cleanly to the user workflows described in the UX section.

## Issues and Recommendations

### 1. Randomness needs an explicit determinism strategy

The simulator includes GBM price motion, correlated shocks, and occasional events, and unseeded tickers get randomized fallback prices. That is fine for a demo, but the plan does not specify how this becomes deterministic for tests and reproducible local runs.

Recommendation:

- Add a seeded RNG path for the simulator.
- Make fallback seed prices deterministic per ticker when `LLM_MOCK=true` or in test mode.
- State whether the simulator should accept an optional seed from config or env.

Without that, snapshot-style frontend tests and backend assertions will be brittle.

### 2. Numeric precision is underspecified

The plan stores cash, quantities, average cost, and portfolio values as `REAL`. That is workable for a prototype, but it will accumulate rounding error if trades are frequent or quantities are fractional.

Recommendation:

- Define a precision policy for all monetary and quantity math.
- Either round consistently at the service boundary or switch to a decimal-based representation.
- Document the exact rounding mode used for fills, P&L, and portfolio valuation.

This matters because the frontend and tests will otherwise disagree on values by small but visible amounts.

### 3. Lazy database initialization needs a concurrency note

The spec says the schema is created lazily on first request. That is fine in principle, but it needs an explicit single-flight or transactional initialization strategy.

Recommendation:

- State that schema creation and seed insertion are protected by a lock or idempotent migration transaction.
- Define what happens if two requests arrive before initialization completes.

Otherwise the first-run path can race under parallel startup or test execution.

### 4. `/api/chat` response semantics need more structure

The chat endpoint description says the backend returns the message plus executed actions, and that failures should surface in the JSON error body. What is still missing is the exact shape of successful action results and partial failures.

Recommendation:

- Define a concrete response schema for chat outcomes.
- Include per-action status, executed identifiers, and validation errors where relevant.
- Make it explicit how the frontend should render a mix of successful and failed actions inline.

This is important because the chat feature is doing more than messaging; it is also an automation surface.

### 5. History endpoints need bounds or pagination rules

`GET /api/chat` and `GET /api/portfolio/history` are useful, but the plan does not define a retention window, page size, or pagination contract.

Recommendation:

- Specify default limits for returned rows.
- Add `limit`/`before` or `cursor` semantics if the history is expected to grow indefinitely.
- State whether the frontend should request the full history or only the most recent slice on refresh.

This avoids unbounded payload growth over time.

### 6. Deployment artifact boundaries should be explicit

The build flow says Next.js is exported statically and then served by FastAPI, but it does not name the exact output directory or the copy target inside the Python image.

Recommendation:

- Specify the frontend build output path.
- Specify the static mount path used by FastAPI.
- Note whether the app is served from `/` or a subpath.

This is a small detail, but it is a common source of build-time friction.

### 7. SSE broadcast semantics should be tightened

The plan says SSE pushes updates for all tickers at about 500ms. That is acceptable for the initial 10-ticker watchlist, but the spec does not say whether events are emitted only on change, whether duplicate values are suppressed, or whether any batching/backpressure strategy exists.

Recommendation:

- State whether unchanged prices are skipped.
- State whether multiple updates may be coalesced in one SSE tick.
- Clarify whether the stream is intended to scale only to the current single-user scope.

This keeps the streaming contract crisp and avoids accidental over-engineering later.

## Verdict

This is a strong project plan. It is sufficiently complete to start implementation, but the items above should be clarified before the team relies on the spec as the sole source of truth. The biggest risks are deterministic testing, numeric precision, and concurrency on first startup.
