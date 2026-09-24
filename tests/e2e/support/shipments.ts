import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type {
  Paged,
  ProblemDetails,
  Shipment,
  ShipmentPriority,
  ShipmentStatus,
  ShipmentStatusEvent,
} from '../../../src/frontend/src/api/client';
import { API, authHeaders, seedWarehouse } from './api';
import { E2E_DB_PATH } from './paths';

/**
 * LOGI-0006 lifecycle fixtures + LOGI-0007 create/list endpoint helpers.
 *
 * `createShipment` / `listShipments` drive the real `POST`/`GET /shipments` endpoints. `seedShipment`
 * and `seedShipmentAt` still write rows straight into the throwaway SQLite file the API runs against:
 * LOGI-0007 removed the "no create endpoint" reason, but a fixture is the only way to pin an instant —
 * AC-8 needs `sla_due_at = NULL` rows (which the API never creates) and AC-9 needs rows on both sides
 * of the BR-2 window without racing the wall clock. That is safe because the API opens the file in WAL
 * mode and these helpers set a busy timeout, so a fixture INSERT never blocks on the API's connection
 * pool (the API is idle whenever a fixture runs — `fullyParallel: false`).
 *
 * The path comes from `./paths`, i.e. the very same value the Playwright config injects as the API's
 * `Database__ConnectionString`, so a fixture can never seed a different database than the API reads.
 * `node:sqlite` is the Node 22 built-in (no npm dependency added); the API project is built with the
 * same toolchain CI pins.
 */

/** Per-run id: keeps every reference code unique so a CI retry (`retries: 1`) cannot re-collide on the UNIQUE index. */
const runId = `e2e${Date.now().toString(36)}`;
let seq = 0;

/** `yyyy-MM-dd HH:mm:ss.fffffff` in UTC — EF Core's SQLite DateTime layout, i.e. what its materializer parses. */
function efTimestamp(at: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, '0');
  return `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())} `
    + `${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())}:${pad(at.getUTCSeconds())}.`
    + `${pad(at.getUTCMilliseconds())}0000`;
}

/** Outcome of a lifecycle call: the event fields on 2xx, the ProblemDetails fields on 4xx. */
export type LifecycleResult = {
  status: number;
  body: Partial<ShipmentStatusEvent> & Partial<ProblemDetails>;
};

/** Outcome of a history read: the page on 2xx, the ProblemDetails fields on 4xx. */
export type HistoryResult = {
  status: number;
  body: Partial<Paged<ShipmentStatusEvent>> & Partial<ProblemDetails>;
};

/**
 * Seeds one shipment and returns its id, in the given initial status (the AC scenarios start from
 * Pending/Assigned/InTransit/Delivered). The origin warehouse is created through the real API (the
 * shipments FK needs it); the shipment row itself is inserted directly, because no create endpoint
 * exists before LOGI-0007.
 */
export async function seedShipment(
  request: APIRequestContext,
  accessToken: string,
  status: ShipmentStatus = 'Pending',
): Promise<number> {
  const tag = `${runId}-${seq++}`;
  const warehouseId = await seedWarehouse(request, accessToken, `QA WH ${tag}`);
  const now = efTimestamp(new Date());

  const db = new DatabaseSync(E2E_DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const inserted = db.prepare(
      `INSERT INTO shipments (reference_code, origin_warehouse_id, destination_address, destination_lat,
         destination_lng, weight_kg, status, priority, sla_due_at, route_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(`SHP-${tag}`.toUpperCase(), warehouseId, '1 QA Destination Rd', null, null, 1000,
      status, 'Standard', null, null, now, now);
    expect(Number(inserted.changes), 'the fixture must insert exactly one shipment row').toBe(1);
    const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
    return Number(row.id);
  } finally {
    db.close();
  }
}

/**
 * POSTs a status transition. Pass `null` as the token for the anonymous (401) case, and
 * `null`/`undefined` as `toStatus` to exercise the required-field 400 path.
 */
export async function postTransition(
  request: APIRequestContext,
  accessToken: string | null,
  shipmentId: number,
  toStatus: string | null | undefined,
  note?: string,
): Promise<LifecycleResult> {
  const data = note === undefined ? { toStatus } : { toStatus, note };
  const response = await request.post(`${API}/api/v1/shipments/${shipmentId}/status-transitions`, {
    headers: accessToken ? authHeaders(accessToken) : {},
    data,
  });
  return { status: response.status(), body: (await response.json()) as LifecycleResult['body'] };
}

/** GETs one page of the audit trail (pass `?page=2&pageSize=2` etc. as `query`). */
export async function getHistory(
  request: APIRequestContext,
  accessToken: string | null,
  shipmentId: number,
  query = '',
): Promise<HistoryResult> {
  const response = await request.get(`${API}/api/v1/shipments/${shipmentId}/status-history${query}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: (await response.json()) as HistoryResult['body'] };
}

/** Walks a shipment along a legal path, asserting 200 on every step and returning the recorded events. */
export async function driveShipment(
  request: APIRequestContext,
  accessToken: string,
  shipmentId: number,
  ...statuses: ShipmentStatus[]
): Promise<ShipmentStatusEvent[]> {
  const events: ShipmentStatusEvent[] = [];
  for (const toStatus of statuses) {
    const { status, body } = await postTransition(request, accessToken, shipmentId, toStatus);
    expect(status, `driving shipment ${shipmentId} to ${toStatus} must be a legal transition`).toBe(200);
    expect(body.toStatus).toBe(toStatus);
    events.push(body as ShipmentStatusEvent);
  }
  return events;
}

/** A directly-seeded shipment row: its id, the code it carries and the origin warehouse it belongs to. */
export type SeededShipment = {
  id: number;
  referenceCode: string;
  warehouseId: number;
  status: ShipmentStatus;
  createdAt: string;
  slaDueAt: string | null;
};

/** What `seedShipmentAt` lets a test pin. Everything is optional and defaults to the plain Pending row. */
export type SeedShipmentAtOptions = {
  /** Initial status — AC-8/AC-9 need Assigned/InTransit/Delivered/Cancelled rows. Defaults to Pending. */
  status?: ShipmentStatus;
  /** Pins `sla_due_at`; `null` (the default) seeds a legacy row without a promise (BR-2 rule 2.7). */
  slaDueAt?: Date | null;
  /** Pins `created_at`; two rows may share one instant to prove the id tiebreak (AC-8). Defaults to now. */
  createdAt?: Date;
  /** Attaches the row to an existing origin warehouse, so one filtered page can hold several rows. */
  warehouseId?: number;
  destinationAddress?: string;
  weightKg?: number;
  priority?: ShipmentPriority;
};

/**
 * Seeds one shipment with pinned instants and status into the throwaway database (see the module note):
 * the only way to obtain `sla_due_at = NULL` rows or rows inside a specific BR-2 window without racing
 * the clock. Its reference code carries the per-run tag and never matches `^SHP-[0-9]{6}$`, so
 * "every code is server-generated" assertions stay scoped to the API-created rows.
 */
export async function seedShipmentAt(
  request: APIRequestContext,
  accessToken: string,
  options: SeedShipmentAtOptions = {},
): Promise<SeededShipment> {
  const tag = `${runId}-${seq++}`;
  const status = options.status ?? 'Pending';
  const createdAt = options.createdAt ?? new Date();
  const slaDueAt = options.slaDueAt ?? null;
  const warehouseId = options.warehouseId ?? (await seedWarehouse(request, accessToken, `QA WH ${tag}`));
  const referenceCode = `SHPX-${tag}`.toUpperCase();
  const stamp = efTimestamp(createdAt);

  const db = new DatabaseSync(E2E_DB_PATH);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    const inserted = db.prepare(
      `INSERT INTO shipments (reference_code, origin_warehouse_id, destination_address, destination_lat,
         destination_lng, weight_kg, status, priority, sla_due_at, route_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(referenceCode, warehouseId, options.destinationAddress ?? '1 QA Destination Rd', null, null,
      options.weightKg ?? 1000, status, options.priority ?? 'Standard',
      slaDueAt ? efTimestamp(slaDueAt) : null, null, stamp, stamp);
    expect(Number(inserted.changes), 'the fixture must insert exactly one shipment row').toBe(1);
    const row = db.prepare('SELECT last_insert_rowid() AS id').get() as { id: number };
    return {
      id: Number(row.id),
      referenceCode,
      warehouseId,
      status,
      createdAt: createdAt.toISOString(),
      slaDueAt: slaDueAt ? slaDueAt.toISOString() : null,
    };
  } finally {
    db.close();
  }
}

/**
 * Outcome of a shipment create: the 201 body on success, the ProblemDetails fields on 4xx.
 */
export type CreateShipmentResult = {
  status: number;
  body: Partial<Shipment> & Partial<ProblemDetails>;
};

/** Outcome of a shipment list read: the page on 2xx, the ProblemDetails fields on 4xx. */
export type ListShipmentsResult = {
  status: number;
  body: Partial<Paged<Shipment>> & Partial<ProblemDetails>;
};

/**
 * Query for `listShipments`: a raw query string (`'?status=Pending'`) or an object whose `undefined`
 * entries are dropped — so a test only sends the filters it means to combine (AC-7).
 */
export type ShipmentListQuery = string | Record<string, string | number | boolean | undefined>;

function toQueryString(query: ShipmentListQuery): string {
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
 * Reads a response body as JSON, tolerating an empty body (an unmatched route answers 404 with no
 * payload) so a status-code assertion reports the status instead of a JSON parse error.
 */
async function readBody<T>(response: { text: () => Promise<string> }): Promise<T> {
  const text = await response.text();
  return (text ? JSON.parse(text) : {}) as T;
}

/**
 * POSTs a shipment (AC-1..AC-5, AC-11). `body` is deliberately untyped so a test can also send
 * server-owned fields (referenceCode/status/slaDueAt/createdAt) and prove BR-1 rule 1.2 — they are
 * ignored, never trusted. Pass `null` as the token for the anonymous (401) case.
 */
export async function createShipment(
  request: APIRequestContext,
  accessToken: string | null,
  body: Record<string, unknown>,
): Promise<CreateShipmentResult> {
  const response = await request.post(`${API}/api/v1/shipments`, {
    headers: accessToken ? authHeaders(accessToken) : {},
    data: body,
  });
  return { status: response.status(), body: await readBody<CreateShipmentResult['body']>(response) };
}

/** GETs one page of the shipment list (AC-6..AC-10); `query` is a raw string or a filter object. */
export async function listShipments(
  request: APIRequestContext,
  accessToken: string | null,
  query: ShipmentListQuery = '',
): Promise<ListShipmentsResult> {
  const response = await request.get(`${API}/api/v1/shipments${toQueryString(query)}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: await readBody<ListShipmentsResult['body']>(response) };
}

