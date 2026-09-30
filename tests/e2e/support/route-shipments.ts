import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type {
  Paged,
  ProblemDetails,
  RouteCapacityView,
  Shipment,
} from '../../../src/frontend/src/api/client';
import { API, authHeaders } from './api';
import { E2E_DB_PATH } from './paths';
import { window } from './routes';

/**
 * LOGI-0010 route-shipment fixtures + endpoint helpers (AC-1..AC-9).
 *
 * Same idiom as `support/routes.ts`: every helper returns the status *together with* the body, so a
 * spec asserts a 2xx payload or a ProblemDetails in one call.
 *
 * `seedAssignedShipment` writes `shipments.route_id` directly because two scenarios cannot be built
 * any other way without a chain of assigns: a route that already sits at a given fraction of its
 * capacity (AC-2's ladder is far clearer seeded than assembled), and a shipment already owned by
 * *another* route (AC-4's cross-route 409). The direct write follows the WAL/`busy_timeout`
 * convention `support/shipments.ts` established and is safe only because the API is idle while a
 * fixture runs (`workers: 1`, `fullyParallel: false`).
 *
 * Reference codes carry the per-run tag and never match `^SHP-[0-9]{6}$`, so "every code is
 * server-generated" assertions stay scoped to API-created rows.
 */

/** Outcome of an assign call: the Shipment on 2xx, the ProblemDetails fields on 4xx. */
export type AssignOutcome = {
  status: number;
  body: Partial<Shipment> & Partial<ProblemDetails>;
};

/** Outcome of the route-shipments list: the page on 2xx, the ProblemDetails fields on 4xx. */
export type RouteShipmentsOutcome = {
  status: number;
  body: Partial<Paged<Shipment> & { capacity: RouteCapacityView }> & Partial<ProblemDetails>;
};

/** Outcome of an unassign: an empty 204 body, or the ProblemDetails on 4xx. */
export type UnassignOutcome = {
  status: number;
  body: Partial<ProblemDetails>;
};

/** Query as a raw string or a filter object (`undefined` values are omitted, as the client does). */
export type RouteShipmentsQuery = string | Record<string, string | number | undefined>;

function toQueryString(query: RouteShipmentsQuery): string {
  if (typeof query === 'string') return query;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

/** Reads a response body as JSON, tolerating an empty 204, so a status assertion reports the status. */
async function readBody<T>(response: { text: () => Promise<string> }): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * POSTs `/api/v1/routes/{id}/shipments` (AC-1..AC-5, AC-9). `body` is deliberately untyped so a
 * test can send `{}` or a non-numeric `shipmentId` (AC-5). Pass `null` for the anonymous 401 case.
 */
export async function assignShipmentToRoute(
  request: APIRequestContext,
  accessToken: string | null,
  routeId: number,
  body: Record<string, unknown>,
): Promise<AssignOutcome> {
  const response = await request.post(`${API}/api/v1/routes/${routeId}/shipments`, {
    headers: accessToken ? authHeaders(accessToken) : {},
    data: body,
  });
  return { status: response.status(), body: await readBody<AssignOutcome['body']>(response) };
}

/** GETs one page of `GET /api/v1/routes/{id}/shipments` with its capacity projection (AC-8). */
export async function listRouteShipments(
  request: APIRequestContext,
  accessToken: string | null,
  routeId: number,
  query: RouteShipmentsQuery = '',
): Promise<RouteShipmentsOutcome> {
  const response = await request.get(`${API}/api/v1/routes/${routeId}/shipments${toQueryString(query)}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: await readBody<RouteShipmentsOutcome['body']>(response) };
}

/** DELETEs `/api/v1/routes/{id}/shipments/{shipmentId}` — the unassign (AC-6). */
export async function removeShipmentFromRoute(
  request: APIRequestContext,
  accessToken: string | null,
  routeId: number,
  shipmentId: number,
): Promise<UnassignOutcome> {
  const response = await request.delete(
    `${API}/api/v1/routes/${routeId}/shipments/${shipmentId}`,
    { headers: accessToken ? authHeaders(accessToken) : {} },
  );
  return { status: response.status(), body: await readBody<UnassignOutcome['body']>(response) };
}
/**
 * A route window far from the default `window(0)`..`window(480)` band, for routes that pin the
 * *shared* driver row.
 *
 * `seedRoute` writes straight to SQLite and therefore bypasses the API's BR-4 overlap guard, so a
 * driver-scoped route seeded on the default band silently double-books that driver. A later spec
 * that legitimately PATCHes a route onto the same driver — LOGI-0009's own-route scoping test does
 * exactly this — then gets a 409 it did not cause and did not expect. Parking these routes on
 * their own band keeps this ticket's fixtures from colliding with anyone else's.
 */
export function driverScopedWindow(minutes: number): string {
  return window(minutes + 1_000_000);
}

/** `yyyy-MM-dd HH:mm:ss.fffffff` in UTC — EF Core's SQLite DateTime layout, i.e. what it parses. */
function efTimestamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} `
    + `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.`
    + `${pad(at.getUTCMilliseconds())}0000`;
}

/** Per-run tag, so a seeded reference code can never collide with another spec's. */
let assignedSeq = 0;
const ASSIGNED_TAG = `e2e${Date.now().toString(36)}`;

/** Options for {@link seedAssignedShipment}. */
export type SeedAssignedOptions = {
  weightKg?: number;
  /**
   * The route the row is linked to. `null` leaves it unassigned (a Pending candidate); a number
   * links it and sets `Assigned`, which is the only way to build AC-4's cross-route case and
   * AC-2's "already near capacity" starting point without a chain of assigns.
   */
  routeId?: number | null;
  /** The origin warehouse FK — must already exist (`fk_shipments_warehouses`). */
  warehouseId: number;
};

/** A shipment row linked to a route, seeded straight into the throwaway SQLite file. */
export type SeededAssignedShipment = {
  id: number;
  referenceCode: string;
  weightKg: number;
  routeId: number | null;
};

/**
 * Seeds one shipment, optionally already assigned to `routeId`.
 *
 * The seed writes the *derived* columns consistently (`status = 'Assigned'` iff a route is set),
 * because a row claiming `Assigned` with a null `route_id` — or a linked row still `Pending` —
 * is not a state the API can produce, and AC-9's atomicity assertions read these rows back.
 */
export async function seedAssignedShipment(
  options: SeedAssignedOptions,
): Promise<SeededAssignedShipment> {
  const weightKg = options.weightKg ?? 100;
  const routeId = options.routeId ?? null;
  const referenceCode = `SHPX-${ASSIGNED_TAG}-${assignedSeq++}`.toUpperCase();
  const stamp = efTimestamp(new Date());

  const db = new DatabaseSync(E2E_DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const inserted = db
      .prepare(
        `INSERT INTO shipments (reference_code, origin_warehouse_id, destination_address, destination_lat,
           destination_lng, weight_kg, status, priority, sla_due_at, route_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        referenceCode,
        options.warehouseId,
        '1 QA Assignment Destination Rd',
        null,
        null,
        weightKg,
        routeId == null ? 'Pending' : 'Assigned',
        'Standard',
        null,
        routeId,
        stamp,
        stamp,
      );
    expect(Number(inserted.changes), 'the fixture must insert exactly one shipment row').toBe(1);
    const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
    return { id: Number(row.id), referenceCode, weightKg, routeId };
  } finally {
    db.close();
  }
}