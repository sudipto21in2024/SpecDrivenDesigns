import { request, type APIRequestContext } from '@playwright/test';
import { API, authHeaders, signIn } from './support/api';

/** Shape of the paged list endpoints the reset walks to collect ids. */
type ListBody = { items: { id: number }[]; totalCount: number };

/**
 * Resets the E2E database to a known (empty) state before the run, per
 * 06-testing-strategy-playwright.md §Playwright conventions.
 *
 * Playwright starts webServers BEFORE globalSetup, so the API is already up and holds the throwaway
 * SQLite file open. The reset therefore goes **through the API only** (delete every row).
 *
 * LOGI-0013: this used to also `rmSync` the live database file. That is a no-op on Windows (the file
 * is locked) but on Linux — i.e. in CI — `unlink` succeeds *while SQLite keeps the file open*: writes
 * continue into a deleted inode and the next physical connection re-creates an empty database, after
 * which every request fails with "no such table …" (HTTP 500). Removing leftovers is now the job of
 * start-api.mjs, which runs before the API starts. Never delete these files here.
 *
 * LOGI-0003: the endpoints require a bearer token, so the reset signs in as the seeded Admin first.
 * Development users are seeded by API startup and are deliberately never deleted here.
 */
export default async function globalSetup(): Promise<void> {
  // A real API context (not raw fetch) so the shared signIn helper — and therefore the same
  // expectation/error reporting — is used here as in the specs.
  const context = await request.newContext();
  try {
    const { accessToken } = await signIn(context, 'Admin');
    const headers = authHeaders(accessToken);

    // Collections are reset in dependency order: once routes exist (LOGI-0009) they reference
    // vehicles and drivers, so routes must be deleted first. A collection whose arm has not landed
    // yet answers 404 and is skipped.
    await resetCollection(context, headers, 'warehouses');
    await resetCollection(context, headers, 'vehicles');
    await resetCollection(context, headers, 'drivers');
  } finally {
    await context.dispose();
  }
}

/**
 * Deletes every row of one collection through the API. A 404 on the list means the arm that owns the
 * endpoint has not landed yet — skipped silently so the suite still boots.
 */
async function resetCollection(
  context: APIRequestContext,
  headers: Record<string, string>,
  collection: string,
): Promise<void> {
  const ids: number[] = [];
  for (let page = 1; ; page++) {
    const listResponse = await context.get(`${API}/api/v1/${collection}?page=${page}&pageSize=100`, { headers });
    if (listResponse.status() === 404) return;
    if (!listResponse.ok()) {
      throw new Error(`Reset failed: ${collection} list returned ${listResponse.status()}`);
    }
    const body = (await listResponse.json()) as ListBody;
    ids.push(...body.items.map((item) => item.id));
    if (ids.length >= body.totalCount || body.items.length === 0) break;
  }

  for (const id of ids) {
    const deleteResponse = await context.delete(`${API}/api/v1/${collection}/${id}`, { headers });
    if (!deleteResponse.ok() && deleteResponse.status() !== 404) {
      throw new Error(`Reset failed: ${collection} delete ${id} returned ${deleteResponse.status()}`);
    }
  }
}


