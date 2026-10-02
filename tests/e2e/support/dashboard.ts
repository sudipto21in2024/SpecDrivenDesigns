import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type {
  DashboardAtRiskShipment,
  DashboardResponse,
  DriverUtilization,
  ProblemDetails,
  ShipmentPriority,
  ShipmentStatus,
  StatusCount,
  VehicleUtilization,
} from '../../../src/frontend/src/api/client';
import { API, authHeaders } from './api';
import { E2E_DB_PATH } from './paths';

/**
 * LOGI-0012 operations-dashboard endpoint helper + fixtures (AC-1..AC-9).
 *
 * Same status+body idiom as `support/planning-board.ts`, so a spec asserts a 200 payload or a
 * ProblemDetails in one call.
 *
 * `seedDashboardShipment` writes `status` / `sla_due_at` / `route_id` straight into the throwaway
 * SQLite file the API reads. It has to: the dashboard projects over all six BR-7 statuses and BR-2's
 * two-hour window, so reaching the interesting cases through the API would mean a five-transition
 * chain per row and a wall-clock race for every due date. The direct write is safe for the reason
 * `support/shipments.ts` documents — WAL plus a busy timeout, and the API is idle while a fixture runs
 * (`workers: 1`, `fullyParallel: false`).
 *
 * SCOPING (the load-bearing rule for this arm): the dashboard is ORG-WIDE, so an unfiltered read also
 * contains rows seeded by every other spec in the suite. Every assertion must therefore be scoped by
 * this arm's own `routeId` or by the per-run tag below. A spec that asserts an unfiltered count is
 * asserting on other specs' data and will fail intermittently depending on run order.
 */

/** The six BR-7 statuses, in the lifecycle order the server must emit (AC-1). */
export const DASHBOARD_STATUSES = [
  'Pending',
  'Assigned',
  'InTransit',
  'Delivered',
  'Delayed',
  'Cancelled',
] as const satisfies readonly ShipmentStatus[];

/** Outcome of a dashboard read: the response on 200, the ProblemDetails fields on 4xx. */
export type DashboardOutcome = {
  status: number;
  body: Partial<DashboardResponse> & Partial<ProblemDetails>;
};

/** The query as a raw string or a filter object; `undefined` values are omitted, as the client does. */
export type DashboardQuery = string | Record<string, string | number | boolean | undefined>;

function toQueryString(query: DashboardQuery): string {
  if (typeof query === 'string') return query.startsWith('?') ? query : `?${query}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized ? `?${serialized}` : '';
}

/** Reads a response body as JSON, tolerating an empty body, so a status assertion reports the status. */
async function readBody<T>(response: { text: () => Promise<string> }): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * GETs `GET /api/v1/dashboard` (AC-1..AC-9). `query` is deliberately untyped so a spec can send an
 * out-of-range `pageSize` or a bogus `status` (AC-8). Pass `null` for the anonymous 401 case.
 */
export async function getDashboard(
  request: APIRequestContext,
  accessToken: string | null,
  query: DashboardQuery = '',
): Promise<DashboardOutcome> {
  const response = await request.get(`${API}/api/v1/dashboard${toQueryString(query)}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: await readBody<DashboardOutcome['body']>(response) };
}

/**
 * Sends an arbitrary verb at a dashboard path — AC-7/AC-8's "the dashboard is read-only", which is a
 * statement about the *surface*: POST/PUT/DELETE must be 405, never a silent 404 or a write. The
 * status AND the `Allow` header come back so a 404 can be told apart from a 405.
 */
export async function sendDashboardVerb(
  request: APIRequestContext,
  accessToken: string,
  verb: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path = '/api/v1/dashboard',
): Promise<{ status: number; body: string; allow: string | undefined }> {
  const response = await request[verb](`${API}${path}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
    data: {},
  });
  return {
    status: response.status(),
    body: await response.text(),
    allow: response.headers()['allow'],
  };
}

/** `yyyy-MM-dd HH:mm:ss.fffffff` in UTC — EF Core's SQLite DateTime layout. */
function efTimestamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} `
    + `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.`
    + `${pad(at.getUTCMilliseconds())}0000`;
}

/** Per-run tag, so a seeded reference code can never collide with another spec's. */
let seq = 0;
const TAG = `e2e${Date.now().toString(36)}`;

/** The substring every reference code seeded by this module shares — for filter-scoped assertions. */
export function dashboardTag(): string {
  return TAG;
}

/** What {@link seedDashboardShipment} lets a spec pin. Everything is optional. */
export type SeedDashboardOptions = {
  /** The origin warehouse FK — must already exist. */
  warehouseId: number;
  status?: ShipmentStatus;
  priority?: ShipmentPriority;
  weightKg?: number;
  /** `null` (the default) leaves the row unassigned. */
  routeId?: number | null;
  /**
   * Pins `sla_due_at`. `null` seeds a BR-2 rule 2.7 row with no promise, so it is NEVER at risk —
   * the case the API can never create through a write, which is why this helper writes SQL.
   */
  slaDueAt?: Date | null;
  createdAt?: Date;
  destinationAddress?: string;
};

/** A directly-seeded dashboard shipment: the ids and instants the specs assert on. */
export type SeededDashboardShipment = {
  id: number;
  referenceCode: string;
  status: ShipmentStatus;
  routeId: number | null;
  slaDueAt: string | null;
};

/**
 * Seeds one shipment row in the given BR-7 status with a pinned SLA instant.
 *
 * The `routeId` does NOT force `status = 'Assigned'`: AC-1 asserts each count matches its own status,
 * which is exactly the assertion a status derived from route_id would break.
 */
export async function seedDashboardShipment(
  options: SeedDashboardOptions,
): Promise<SeededDashboardShipment> {
  const status = options.status ?? 'Pending';
  const slaDueAt = options.slaDueAt ?? null;
  const createdAt = options.createdAt ?? new Date();
  const referenceCode = `SHPD-${TAG}-${seq++}`.toUpperCase();
  const stamp = efTimestamp(createdAt);

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
        options.destinationAddress ?? '1 QA Dashboard Destination Rd',
        null,
        null,
        options.weightKg ?? 100,
        status,
        options.priority ?? 'Standard',
        slaDueAt ? efTimestamp(slaDueAt) : null,
        options.routeId ?? null,
        stamp,
        stamp,
      );
    expect(Number(inserted.changes), 'the fixture must insert exactly one shipment row').toBe(1);
    const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
    return {
      id: Number(row.id),
      referenceCode,
      status,
      routeId: options.routeId ?? null,
      slaDueAt: slaDueAt ? slaDueAt.toISOString() : null,
    };
  } finally {
    db.close();
  }
}

/**
 * The `StatusCount` entry for `status`, failing the test if the server omitted it.
 *
 * AC-1's rule is that all six are ALWAYS present, zero counts included — so an absent entry is a
 * failure here rather than something a caller has to null-check around.
 */
export function statusCountOf(body: Partial<DashboardResponse>, status: ShipmentStatus): StatusCount {
  const entry = (body.statusCounts ?? []).find((candidate) => candidate.status === status);
  expect(entry, `the dashboard must always carry a ${status} count (AC-1)`).toBeDefined();
  return entry!;
}

/** The at-risk page the response carries, failing the test if it is absent (AC-2/AC-3). */
export function atRiskPageOf(body: Partial<DashboardResponse>) {
  expect(body.atRiskShipments, 'the dashboard must carry an at-risk page (AC-2)').toBeDefined();
  return body.atRiskShipments!;
}

/** The vehicle utilization snapshot, failing the test if it is absent (AC-4). */
export function vehicleUtilizationOf(body: Partial<DashboardResponse>): VehicleUtilization {
  expect(body.vehicleUtilization, 'the dashboard must carry vehicle utilization (AC-4)').toBeDefined();
  return body.vehicleUtilization as VehicleUtilization;
}

/** The driver utilization snapshot, failing the test if it is absent (AC-5). */
export function driverUtilizationOf(body: Partial<DashboardResponse>): DriverUtilization {
  expect(body.driverUtilization, 'the dashboard must carry driver utilization (AC-5)').toBeDefined();
  return body.driverUtilization as DriverUtilization;
}

/** The at-risk row for `id`, failing the test if the page does not carry it. */
export function atRiskRowOf(body: Partial<DashboardResponse>, id: number): DashboardAtRiskShipment {
  const row = (body.atRiskShipments?.items ?? []).find((candidate) => candidate.id === id);
  expect(row, `the at-risk page must carry shipment ${id}`).toBeDefined();
  return row!;
}

/**
 * A Date `minutesFromNow` from the current clock — the helper specs use to place a row inside or
 * outside BR-2's two-hour window, rather than hard-coding an instant that would rot.
 */
export function slaMinutesFromNow(minutesFromNow: number): Date {
  return new Date(Date.now() + minutesFromNow * 60_000);
}
