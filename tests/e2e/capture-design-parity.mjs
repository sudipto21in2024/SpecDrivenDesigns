/**
 * Design-parity screenshot capture.
 *
 * Not a test: this asserts nothing and writes PNGs to test-results/design-parity/.
 * It drives the already-running Docker stack (nginx on :8080, seeded demo data) so the
 * screenshots show real rows, paginated grids and real status chips rather than empty states.
 *
 *   node capture-design-parity.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = new URL('../test-results/design-parity/', import.meta.url).pathname.replace(/^\//, '');
mkdirSync(OUT, { recursive: true });

const ADMIN = { email: 'alex@logiflow.dev', password: 'logiflow-dev-password' };

const PAGES = [
  { name: 'vehicles', path: '/vehicles' },
  { name: 'warehouses', path: '/warehouses' },
  { name: 'drivers', path: '/drivers' },
  { name: 'routes', path: '/routes' },
  { name: 'shipments', path: '/shipments' },
  { name: 'dashboard', path: '/' },
  { name: 'planning-board', path: '/planning' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();

// Sign in once; the SPA persists the token, so every page below is captured authenticated.
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByLabel(/email/i).fill(ADMIN.email);
await page.getByLabel(/password/i).fill(ADMIN.password);
await page.getByRole('button', { name: /sign in|log in/i }).click();
await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 20_000 });

for (const { name, path } of PAGES) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  // Let fonts settle and any client-side data query resolve before capturing.
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
  console.log(`captured ${name}`);
}

await browser.close();
console.log(`\nScreenshots written to ${OUT}`);