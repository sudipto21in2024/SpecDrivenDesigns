import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const API = 'http://localhost:5199';

/**
 * Resets the E2E database to a known (empty) state before the run, per
 * 06-testing-strategy-playwright.md §Playwright conventions.
 *
 * Playwright starts webServers BEFORE globalSetup, so the API is already up and
 * holds the throwaway SQLite file open. We therefore reset via the API (delete
 * every warehouse) and only opportunistically remove stale database files.
 */
export default async function globalSetup(): Promise<void> {
  // Best-effort cleanup of leftovers from previous runs that exited uncleanly.
  const dbPath = join(__dirname, '..', '..', 'src', 'backend', 'LogiFlow.Api');
  for (const file of ['e2e-logiflow.db', 'e2e-logiflow.db-wal', 'e2e-logiflow.db-shm']) {
    const full = join(dbPath, file);
    try {
      if (existsSync(full)) rmSync(full);
    } catch {
      // Locked by the running API process — the data reset below handles it.
    }
  }

  // API-driven reset: collect all ids, then delete each.
  const ids: number[] = [];
  for (let page = 1; ; page++) {
    const response = await fetch(`${API}/api/v1/warehouses?page=${page}&pageSize=100`);
    if (!response.ok) {
      throw new Error(`Reset failed: list endpoint returned ${response.status}`);
    }
    const body = (await response.json()) as { items: { id: number }[]; totalCount: number };
    ids.push(...body.items.map((item) => item.id));
    if (ids.length >= body.totalCount || body.items.length === 0) break;
  }

  await Promise.all(
    ids.map(async (id) => {
      const response = await fetch(`${API}/api/v1/warehouses/${id}`, { method: 'DELETE' });
      if (!response.ok && response.status !== 404) {
        throw new Error(`Reset failed: delete ${id} returned ${response.status}`);
      }
    }),
  );
}
