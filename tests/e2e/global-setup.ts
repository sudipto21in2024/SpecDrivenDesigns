import { request, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { API, authHeaders, signIn } from './support/api';
import { E2E_DB_PATH } from './support/paths';

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

    // Routes are reset first and *directly*: LOGI-0009 deliberately ships no DELETE endpoint
    // (route deletion is out of scope), so the API cannot empty the table — yet a leftover route
    // makes every vehicle/driver delete below answer 409 (their FKs are `Restrict`). Writing rows
    // from a second SQLite connection is the same, accepted idiom as `support/shipments.ts`
    // (WAL mode + busy timeout); this is a row delete, never the file-unlink LOGI-0013 removed.
    resetRoutes();
    // The remaining collections are reset through the API, in dependency order: routes referenced
    // them, so routes had to go first. A collection whose arm has not landed yet answers 404 and
    // is skipped.
    await resetCollection(context, headers, 'warehouses');
    await resetCollection(context, headers, 'vehicles');
    await resetCollection(context, headers, 'drivers');
  } finally {
    await context.dispose();
  }
}

/**
 * Deletes every `routes` row straight from the throwaway SQLite file (see the call site for why
 * this one collection cannot go through the API). A missing table means the LOGI-0009 migration
 * has not been applied to this database yet — treated like the API's 404 for a not-yet-landed arm.
 */
function resetRoutes(): void {
  const db = new DatabaseSync(E2E_DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.prepare('DELETE FROM routes').run();
  } catch (error) {
    if (!String((error as Error).message).includes('no such table')) throw error;
  } finally {
    db.close();
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


