import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { request } from '@playwright/test';
import { API, authHeaders, signIn } from './support/api';

/**
 * Resets the E2E database to a known (empty) state before the run, per
 * 06-testing-strategy-playwright.md §Playwright conventions.
 *
 * Playwright starts webServers BEFORE globalSetup, so the API is already up and
 * holds the throwaway SQLite file open. We therefore reset via the API (delete
 * every warehouse) and only opportunistically remove stale database files.
 *
 * LOGI-0003: the warehouse endpoints require a bearer token, so the reset signs in as the seeded
 * Admin first. Development users are seeded by API startup and are deliberately never deleted here.
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

  // A real API context (not raw fetch) so the shared signIn helper — and therefore the same
  // expectation/error reporting — is used here as in the specs.
  const context = await request.newContext();
  try {
    const { accessToken } = await signIn(context, 'Admin');
    const headers = authHeaders(accessToken);

    // API-driven reset: collect all ids, then delete each.
    const ids: number[] = [];
    for (let page = 1; ; page++) {
      const listResponse = await context.get(`${API}/api/v1/warehouses?page=${page}&pageSize=100`, { headers });
      if (!listResponse.ok()) {
        throw new Error(`Reset failed: list endpoint returned ${listResponse.status()}`);
      }
      const body = (await listResponse.json()) as { items: { id: number }[]; totalCount: number };
      ids.push(...body.items.map((item) => item.id));
      if (ids.length >= body.totalCount || body.items.length === 0) break;
    }

    for (const id of ids) {
      const deleteResponse = await context.delete(`${API}/api/v1/warehouses/${id}`, { headers });
      if (!deleteResponse.ok() && deleteResponse.status() !== 404) {
        throw new Error(`Reset failed: delete ${id} returned ${deleteResponse.status()}`);
      }
    }
  } finally {
    await context.dispose();
  }
}
