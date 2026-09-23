import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type { Paged, ProblemDetails, ShipmentStatus, ShipmentStatusEvent } from '../../../src/frontend/src/api/client';
import { API, authHeaders, seedWarehouse } from './api';
import { E2E_DB_PATH } from './paths';

/**
 * LOGI-0006 shipment fixtures + lifecycle endpoint helpers.
 *
 * Creation is LOGI-0007, so the contract still exposes only the two lifecycle paths and the spec's
 * §3 precondition applies: fixtures seed rows straight into the throwaway SQLite file the API runs
 * against. That is safe here because the API opens it in WAL mode and this helper sets a busy
 * timeout, so a fixture INSERT never blocks on the API's connection pool (the API is idle whenever a
 * fixture runs — `fullyParallel: false`).
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
