import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// LogiFlow frontend — React 18 + MUI v5 (ADR-002), contract-first client (ADR-004).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Dev proxy to the ASP.NET Core API (LOGI-0001 backend slice).
      '/api': {
        target: 'http://localhost:5199',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
