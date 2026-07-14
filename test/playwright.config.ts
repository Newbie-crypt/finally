import { defineConfig, devices } from '@playwright/test';

/**
 * FinAlly E2E configuration (PLAN.md §12).
 *
 * The suite runs against a *running* FinAlly container — it never boots the app
 * itself. Two supported ways to point it at one:
 *
 *   docker compose -f test/docker-compose.test.yml up --build --abort-on-container-exit
 *       -> BASE_URL=http://app:8000, browsers come from the Playwright image
 *
 *   BASE_URL=http://localhost:8000 npx playwright test      (app already up)
 *
 * Single worker, no parallelism, files run in alphabetical order: the tests
 * share one SQLite database and one cash balance, so they are deliberately
 * sequenced (01-fresh-start asserts the pristine $10,000 seed before anything
 * spends it). The compose stack mounts /app/db as tmpfs, so every `up` starts
 * from a freshly seeded database.
 */
export default defineConfig({
  testDir: './tests',
  // Shared mutable backend state -> strictly serial, one browser, one worker.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Streaming assertions poll for up to ~20s; give tests room.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:8000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // Desktop-first terminal layout (PLAN.md §2) — the heatmap and P&L chart
    // need real estate or Recharts renders zero-size cells.
    viewport: { width: 1600, height: 1000 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1600, height: 1000 },
        launchOptions: {
          // Belt-and-braces against Chrome silently rewriting the plain-http
          // compose URL to https:// (see the service name note in
          // docker-compose.test.yml).
          args: ['--disable-features=HttpsUpgrades,HttpsFirstBalancedModeAutoEnable'],
        },
      },
    },
  ],
});
