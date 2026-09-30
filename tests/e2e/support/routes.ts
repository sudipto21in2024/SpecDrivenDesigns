import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type { Paged, ProblemDetails, Route, RouteStatus } from '../../../src/frontend/src/api/client';
import { API, authHeaders } from './api';
import { E2E_DB_PATH } from './paths';

/**
 * LOGI-0009 route fixtures + endpoint helpers (AC-1..AC-10).
 *
 * `createRoute` / `getRoute` / `listRoutes` / `patchRoute` drive the real endpoints and return the
 * status *together with* the body, so a spec can assert a 2xx payload and the ProblemDetails of a
 * 400/401/403/404/409 without a second request.
 *
 * `seedRoute` inserts a row straight into the throwaway SQLite file the API runs against, because
 * a route's `status` and planned window are server-owned: `POST /routes` can only ever mint
 * `Planned`, so AC-5's InProgress half, AC-6's non-Planned PATCH and the terminal-route
 * non-conflict case exist only as seeded rows. The idiom (WAL mode, `busy_timeout`, EF's DateTime
 * text layout) is the one `support/shipments.ts` established; the direct write is safe because the
 * API is idle while a fixture runs — `fullyParallel: false`.
 *
 * Names and windows are unique per run, so a CI retry (`retries: 1`) can neither re-collide on a
 * name nor trip over the previous attempt's overlap guard.
 */

/** Per-run id: keeps every route name unique in the shared throwaway database. */
const runId = `e2e${Date.now().toString(36)}`;
let seq = 0;

/** A route name that is unique per call and inside the 200-char contract limit. */
export function routeName(tag: string): string {
  return `RT ${runId}-${tag}-${seq++}`;
}

/** A plate/licence value that is unique per call and inside the 20-char contract limit. */
export function uniqueRef(tag: string): string {
  return `${tag}-${runId}-${seq++}`.slice(0, 20).toUpperCase();
}

/**
 * Planned windows are pinned to a fixed epoch plus a per-run minute offset. Pinning keeps every
 * overlap assertion independent of the wall clock, and the per-run offset keeps a *reused* database
 * (Playwright's `reuseExistingServer` leaves the previous run's rows in place) from making this
 * run's window look like it double-books a stale vehicle or driver.
 */
const RUN_OFFSET_MINUTES = Math.floor(Date.now() / 60_000) % 1_000_000;
const EPOCH_MS = Date.UTC(2030, 0, 1);

/** An RFC3339 UTC instant `minutes` after this run's window base (`window(480)` is 8 hours later). */
export function window(minutes: number): string {
  return new Date(EPOCH_MS + (RUN_OFFSET_MINUTES + minutes) * 60_000).toISOString().replace('.000Z', 'Z');
}

/** `yyyy-MM-dd HH:mm:ss.fffffff` in UTC — EF Core's SQLite DateTime layout, i.e. what it parses. */
function efTimestamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} `
    + `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.`
    + `${pad(at.getUTCMilliseconds())}0000`;
}

/** Outcome of a single-route call: the Route on 2xx, the ProblemDetails fields on 4xx. */
export type RouteOutcome = {
  status: number;
  body: Partial<Route> & Partial<ProblemDetails>;
};

/** Outcome of a route list call: the page on 2xx, the ProblemDetails fields on 4xx. */
export type RouteListOutcome = {
  status: number;
  body: Partial<Paged<Route>> & Partial<ProblemDetails>;
};

/** Query as a raw string or a filter object (`undefined` values are omitted, as the client does). */
export type RouteListQuery = string | Record<string, string | number | undefined>;

function toQueryString(query: RouteListQuery): string {
  if (typeof query === 'string') return query;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

/**
 * Reads a response body as JSON, tolerating an empty body, so a status-code assertion reports the
 * status instead of a JSON parse error.
 */
async function readBody<T>(response: { text: () => Promise<string> }): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * POSTs a route (AC-1, AC-3..AC-5, AC-10). `body` is deliberately untyped so a test can send
 * server-owned keys (AC-10) or a malformed window (AC-3). Pass `null` as the token for the
 * anonymous (401) case.
 */
export async function createRoute(
  request: APIRequestContext,
  accessToken: string | null,
  body: Record<string, unknown>,
): Promise<RouteOutcome> {
  const response = await request.post(`${API}/api/v1/routes`, {
    headers: accessToken ? authHeaders(accessToken) : {},
    data: body,
  });
  return { status: response.status(), body: await readBody<RouteOutcome['body']>(response) };
}

/** GETs `GET /api/v1/routes/{id}` (AC-1, AC-4, AC-6). Pass `null` as the token for the 401 case. */
export async function getRoute(
  request: APIRequestContext,
  accessToken: string | null,
  routeId: number,
): Promise<RouteOutcome> {
  const response = await request.get(`${API}/api/v1/routes/${routeId}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: await readBody<RouteOutcome['body']>(response) };
}

/** GETs one page of `GET /api/v1/routes` (AC-1, AC-7, AC-9). Pass `null` as the token for the 401 case. */
export async function listRoutes(
  request: APIRequestContext,
  accessToken: string | null,
  query: RouteListQuery = '',
): Promise<RouteListOutcome> {
  const response = await request.get(`${API}/api/v1/routes${toQueryString(query)}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: await readBody<RouteListOutcome['body']>(response) };
}

/**
 * PATCHes `PATCH /api/v1/routes/{id}` (AC-2..AC-6, AC-10). `body` is untyped so a test can send an
 * explicit `null` clear (AC-2), an empty `{}` (AC-3) or server-owned keys (AC-10).
 */
export async function patchRoute(
  request: APIRequestContext,
  accessToken: string | null,
  routeId: number,
  body: Record<string, unknown>,
): Promise<RouteOutcome> {
  const response = await request.patch(`${API}/api/v1/routes/${routeId}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
    data: body,
  });
  return { status: response.status(), body: await readBody<RouteOutcome['body']>(response) };
}

/** A directly-seeded route: its id, the name it carries and the window it was seeded with. */
export type SeededRoute = {
  id: number;
  name: string;
  plannedStart: string;
  plannedEnd: string;
};

/** Options for {@link seedRoute}; every field mirrors a `routes` column the scenario needs. */
export type SeedRouteOptions = {
  name?: string;
  status?: RouteStatus;
  vehicleId?: number | null;
  driverId?: number | null;
  plannedStart?: string;
  plannedEnd?: string;
  /** EF's `created_at`, so the AC-9 `-createdAt` ordering assertion is clock-independent. */
  createdAt?: string;
};

/**
 * Seeds one route row and returns its id. Only values the API cannot mint are worth seeding:
 * non-`Planned` statuses (AC-5 InProgress half, AC-6, terminal-route non-conflict) and pinned
 * instants (AC-9 ordering). Ids referenced by `vehicleId`/`driverId` must already exist — the
 * `routes` foreign keys (`fk_routes_vehicles` / `fk_routes_drivers`) are enforced by SQLite.
 */
export async function seedRoute(options: SeedRouteOptions = {}): Promise<SeededRoute> {
  const name = options.name ?? routeName('SEED');
  const plannedStart = options.plannedStart ?? window(0);
  const plannedEnd = options.plannedEnd ?? window(480);
  const createdAt = options.createdAt ?? new Date().toISOString();

  const db = new DatabaseSync(E2E_DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const inserted = db
      .prepare(
        `INSERT INTO routes (name, planned_start, planned_end, actual_start, actual_end,
           vehicle_id, driver_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        name,
        efTimestamp(new Date(plannedStart)),
        efTimestamp(new Date(plannedEnd)),
        null,
        null,
        options.vehicleId ?? null,
        options.driverId ?? null,
        options.status ?? 'Planned',
        efTimestamp(new Date(createdAt)),
        null,
      );
    expect(Number(inserted.changes), 'the fixture must insert exactly one route row').toBe(1);
    const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
    return { id: Number(row.id), name, plannedStart, plannedEnd };
  } finally {
    db.close();
  }
}

/** The driver fields the LOGI-0009 Driver-scoping scenarios need. */
export type DriverRow = {
  id: number;
  fullName: string;
  licenseNumber: string;
  status: string;
  userId: number | null;
};

/** Every driver row visible to `accessToken` (the API caps `pageSize` at 100). */
export async function listDriverRows(
  request: APIRequestContext,
  accessToken: string,
): Promise<DriverRow[]> {
  const response = await request.get(`${API}/api/v1/drivers?page=1&pageSize=100`, {
    headers: authHeaders(accessToken),
  });
  expect(response.status(), 'the admin driver list must be readable').toBe(200);
  const body = (await response.json()) as { items: DriverRow[] };
  return body.items;
}

/**
 * The driver row linked to `userId`, if any. `GET /routes` scopes a Driver by
 * `drivers.user_id = <current user>`, so this link is what makes an own-route assertion possible —
 * and it is 1:1, which is why the helpers below tolerate a link another spec left behind.
 */
export async function findDriverLinkedToUser(
  request: APIRequestContext,
  accessToken: string,
  userId: number,
): Promise<DriverRow | null> {
  return (await listDriverRows(request, accessToken)).find((driver) => driver.userId === userId) ?? null;
}

/** Clears a driver's user link (PUT with `userId: null`) so the seeded Driver account can relink. */
export async function unlinkDriver(
  request: APIRequestContext,
  accessToken: string,
  driver: DriverRow,
): Promise<void> {
  const response = await request.put(`${API}/api/v1/drivers/${driver.id}`, {
    headers: authHeaders(accessToken),
    data: {
      fullName: driver.fullName,
      licenseNumber: driver.licenseNumber,
      status: driver.status,
      userId: null,
    },
  });
  expect(response.status(), `unlinking driver ${driver.id} must succeed`).toBe(200);
}

/**
 * The driver row linked to `userId`, creating one when none exists. The 1:1 link is shared suite
 * state (LOGI-0005's driver suite links the same seeded account), so a 409 means another file won
 * the race — the existing holder is then reused instead of failing the run.
 */
export async function ensureDriverLinkedToUser(
  request: APIRequestContext,
  accessToken: string,
  userId: number,
): Promise<DriverRow> {
  const existing = await findDriverLinkedToUser(request, accessToken, userId);
  if (existing) return existing;

  const created = await request.post(`${API}/api/v1/drivers`, {
    headers: authHeaders(accessToken),
    data: {
      fullName: `Route QA driver ${routeName('LINK')}`,
      licenseNumber: uniqueRef('RDL'),
      status: 'Active',
      userId,
    },
  });

  if (created.status() === 201) {
    return (await created.json()) as DriverRow;
  }

  // 409 → the link was taken between the list and the create; reuse that holder.
  expect(created.status(), 'a taken user link is the only tolerated create failure').toBe(409);
  const holder = await findDriverLinkedToUser(request, accessToken, userId);
  expect(holder, 'a 409 means some driver already holds the link').not.toBeNull();
  return holder!;
}
