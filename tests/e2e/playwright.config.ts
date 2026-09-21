import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

/**
 * LOGI-0001 E2E config (06-testing-strategy-playwright.md).
 * Runs the integrated stack: ASP.NET Core API (throwaway SQLite) + Vite dev server
 * proxying /api to it. Each run starts from an empty database: start-api.mjs deletes the file
 * *before* the API starts (LOGI-0013 — never while it runs).
 */

/**
 * Absolute path of the throwaway database. An absolute path keeps the API's working directory out
 * of the picture: a relative `Data Source` is resolved against the app process's CWD, which differs
 * between a local run and CI.
 */
const API_PROJECT = resolve(__dirname, '..', '..', 'src', 'backend', 'LogiFlow.Api');
const E2E_DB_PATH = resolve(API_PROJECT, 'e2e-logiflow.db');

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
