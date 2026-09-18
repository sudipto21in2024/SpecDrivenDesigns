import { defineConfig } from '@playwright/test';

/**
 * LOGI-0001 E2E config (06-testing-strategy-playwright.md).
 * Runs the integrated stack: ASP.NET Core API (throwaway SQLite) + Vite dev server
 * proxying /api to it. Each run starts from an empty database (see global-setup.ts).
 */
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
      command: 'dotnet run --project ../../src/backend/LogiFlow.Api -c Release --no-build --urls http://localhost:5199',
      url: 'http://localhost:5199/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
      env: {
        ASPNETCORE_ENVIRONMENT: 'Development',
        Database__ConnectionString: 'Data Source=e2e-logiflow.db',
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
