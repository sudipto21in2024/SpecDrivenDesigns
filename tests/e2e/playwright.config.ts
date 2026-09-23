import { defineConfig } from '@playwright/test';
import { E2E_DB_PATH } from './support/paths';

/**
 * LOGI-0001 E2E config (06-testing-strategy-playwright.md).
 * Runs the integrated stack: ASP.NET Core API (throwaway SQLite) + Vite dev server
 * proxying /api to it. Each run starts from an empty database: start-api.mjs deletes the file
 * *before* the API starts (LOGI-0013 — never while it runs).
 */

// The throwaway database path lives in `support/paths.ts` so the config (API webServer) and the
// shipment fixtures seeding rows into it can never drift apart (LOGI-0013).

export default defineConfig({
  testDir: '.',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    actionTimeout: 7_000,
  },
  webServer: [
    {
      // The wrapper owns the database lifecycle: it removes any leftovers and only then starts the
      // API, so the file is never unlinked while SQLite has it open (see start-api.mjs).
      command: 'node start-api.mjs',
      url: 'http://localhost:5199/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        E2E_DB_PATH,
        Database__ConnectionString: `Data Source=${E2E_DB_PATH}`,
      },
    },
    {
      // Production build + preview (06-testing-strategy-playwright.md §Environments).
      command: 'npm --prefix ../../src/frontend run build && npm --prefix ../../src/frontend run preview -- --port 5173 --strictPort',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
