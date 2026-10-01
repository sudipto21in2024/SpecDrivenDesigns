import { expect, type APIRequestContext } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import type {
  BoardShipmentCard,
  PlanningBoardResponse,
  ProblemDetails,
  RouteCapacityView,
  ShipmentPriority,
  ShipmentStatus,
} from '../../../src/frontend/src/api/client';
import { API, authHeaders } from './api';
import { E2E_DB_PATH } from './paths';

/**
 * LOGI-0011 planning-board endpoint helper + fixtures (AC-1..AC-9).
 *
 * Same status+body idiom as `support/route-shipments.ts`, so a spec asserts a 200 payload or a
 * ProblemDetails in one call.
 *
 * `seedBoardShipment` writes `status` / `route_id` / `sla_due_at` / `priority` straight into the
 * throwaway SQLite file the API reads. It has to: the board is an org-wide projection over *all six*
 * BR-7 statuses, so a board with something in every column would otherwise need a five-transition
 * chain per card, and AC-8's "312 cards in one column" would need 312 such chains. The direct write is
 * safe for the reason `support/shipments.ts` documents — WAL plus a busy timeout, and the API is idle
 * while a fixture runs (`workers: 1`, `fullyParallel: false`).
 *
 * Every seeded row is meant to be reachable through a filter (routeId or the `q` tag below), because
 * the board is org-wide: an unfiltered board also contains rows seeded by every other spec.
 */

/** The six BR-7 statuses, in the lifecycle order the server must emit (AC-1). */
export const BOARD_STATUSES = [
  'Pending',
  'Assigned',
  'InTransit',
  'Delivered',
  'Delayed',
  'Cancelled',
] as const satisfies readonly ShipmentStatus[];

/** Outcome of a board read: the response on 200, the ProblemDetails fields on 4xx/405. */
export type PlanningBoardOutcome = {
  status: number;
  body: Partial<PlanningBoardResponse> & Partial<ProblemDetails>;
};

/** The query as a raw string or a filter object; `undefined` values are omitted, as the client does. */
export type BoardQuery = string | Record<string, string | number | boolean | undefined>;

function toQueryString(query: BoardQuery): string {
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
 * GETs `GET /api/v1/planning-board` (AC-1..AC-9). `query` is deliberately untyped so a spec can send
 * an out-of-range `maxPerColumn` or a bogus `status` (AC-8). Pass `null` for the anonymous 401 case.
 */
export async function getPlanningBoard(
  request: APIRequestContext,
  accessToken: string | null,
  query: BoardQuery = '',
): Promise<PlanningBoardOutcome> {
  const response = await request.get(`${API}/api/v1/planning-board${toQueryString(query)}`, {
    headers: accessToken ? authHeaders(accessToken) : {},
  });
  return { status: response.status(), body: await readBody<PlanningBoardOutcome['body']>(response) };
}

/**
 * Sends an arbitrary verb at a planning-board path — AC-7's "the board is read-only", which is a
 * statement about the *surface*: POST/PUT/DELETE must be 405, never a silent 404 or a write.
 * Returns the status *and* the ProblemDetails-ish body so a 404 can be told apart from a 405.
 */
export async function sendBoardVerb(
  request: APIRequestContext,
  accessToken: string,
  verb: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path = '/api/v1/planning-board',
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

/**
 * The substring every reference code seeded by this module shares — the `q` filter this arm scopes
 * its assertions with, so a board assertion never sees another spec's rows.
 */
export function boardTag(): string {
  return TAG;
}

/** What {@link seedBoardShipment} lets a spec pin. Everything is optional. */
export type SeedBoardOptions = {
  /** The origin warehouse FK — must already exist. */
  warehouseId: number;
  status?: ShipmentStatus;
  priority?: ShipmentPriority;
  weightKg?: number;
  /** `null` (the default) leaves the row in the unassigned lane (AC-5). */
  routeId?: number | null;
  /** Pins `sla_due_at`; `null` seeds a BR-2 rule 2.7 row with no promise, so it is never at risk. */
  slaDueAt?: Date | null;
  /** Pins `created_at`, so the id tiebreak (AC-9) can be asserted with equal due dates. */
  createdAt?: Date;
  destinationAddress?: string;
};

/** A directly-seeded board shipment: the ids and instants the specs assert on. */
export type SeededBoardShipment = {
  id: number;
  referenceCode: string;
  status: ShipmentStatus;
  routeId: number | null;
  slaDueAt: string | null;
  createdAt: string;
};

/**
 * Seeds one shipment row in the given BR-7 status, optionally linked to a route.
 *
 * Unlike `support/route-shipments.ts`, a `routeId` here does NOT force `status = 'Assigned'`: an
 * InProgress route legitimately holds Delivered cards, and AC-1's "each column matches its own
 * status" is precisely the assertion a status derived from route_id would break.
 */
export async function seedBoardShipment(options: SeedBoardOptions): Promise<SeededBoardShipment> {
  const status = options.status ?? 'Pending';
  const slaDueAt = options.slaDueAt ?? null;
  const createdAt = options.createdAt ?? new Date();
  const referenceCode = `SHPB-${TAG}-${seq++}`.toUpperCase();
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
        options.destinationAddress ?? '1 QA Board Destination Rd',
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
      createdAt: createdAt.toISOString(),
    };
  } finally {
    db.close();
  }
}

/** The BR-5 capacity view a board route card must report for `routeId`. */
export type CapacityOf = Partial<RouteCapacityView>;

/**
 * Every card in the board, flattened out of the columns in server order — the "list view" of AC-2,
 * which is a projection of the one response rather than a second endpoint.
 */
export function flattenBoardCards(body: Partial<PlanningBoardResponse>): BoardShipmentCard[] {
  return (body.columns ?? []).flatMap((column) => column.cards ?? []);
}

/** The column for `status`, failing the test if the server omitted it (AC-1's "never omitted"). */
export function columnOf(
  body: Partial<PlanningBoardResponse>,
  status: ShipmentStatus,
): { status: ShipmentStatus; totalCount: number; truncated: boolean; cards: BoardShipmentCard[] } {
  const column = (body.columns ?? []).find((candidate) => candidate.status === status);
  expect(column, `the board must always carry a ${status} column (AC-1)`).toBeDefined();
  return column!;
}

/** The route card for `routeId`, failing the test if it is absent (AC-4). */
export function routeCardOf(body: Partial<PlanningBoardResponse>, routeId: number) {
  const card = (body.routes ?? []).find((route) => route.id === routeId);
  expect(card, `the board must carry a route card for route ${routeId} (AC-4)`).toBeDefined();
  return card!;
}
