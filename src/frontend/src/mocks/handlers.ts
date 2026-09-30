import { http, HttpResponse } from 'msw';
import type { AuthUser, ProblemDetails, Role, RouteCapacityView, Vehicle, VehicleInput, Warehouse, WarehouseInput, Driver, DriverInput, ShipmentStatusEvent, ShipmentStatus, StatusTransitionRequest, Shipment, ShipmentInput, ShipmentPriority, Route, RouteStatus } from '../api/client';

/**
 * MSW handlers derived from contracts/v1-openapi.yaml (ADR-004). The in-memory store mirrors the API
 * behaviour (pagination envelope, ProblemDetails errors, 201/204/404 semantics, bearer auth and role
 * checks) so UI work and unit tests run without the backend.
 *
 * LOGI-0003: the auth endpoints and the role requirements are modelled here too — including 401 and
 * 403 — so UI tests can assert that the SPA behaves correctly for each role rather than only against
 * a fully-privileged user.
 */

export const warehousesDb: Warehouse[] = [];
export const vehiclesDb: Vehicle[] = [];
export const driversDb: Driver[] = [];
let nextId = 1;

/** Access tokens issued by the mock login, mapped to the user they identify. */
const sessions = new Map<string, AuthUser>();
let sessionCounter = 0;

/** The seeded accounts, mirroring SeedData.Users and SeedData.DevelopmentPassword. */
export const mockUsers: AuthUser[] = [
  { id: 1, email: 'alex@logiflow.dev', fullName: 'Alex Adams', role: 'Admin' },
  { id: 2, email: 'dana@logiflow.dev', fullName: 'Dana Doolittle', role: 'Dispatcher' },
  { id: 3, email: 'raj@logiflow.dev', fullName: 'Raj Raman', role: 'Driver' },
  { id: 4, email: 'vera@logiflow.dev', fullName: 'Vera Vogel', role: 'Viewer' },
];

export const mockPassword = 'logiflow-dev-password';

/** Role → allowed operations, mirroring the contract's x-roles annotations. */
const roleRules: Record<Role, { read: boolean; write: boolean; delete: boolean }> = {
  Admin: { read: true, write: true, delete: true },
  Dispatcher: { read: true, write: true, delete: false },
  Driver: { read: true, write: false, delete: false },
  Viewer: { read: true, write: false, delete: false },
};

/**
 * Driver role rules — the Driver persona is excluded from /drivers entirely
 * (master-data surface per spec §2: Driver role 403 even on reads).
 */
const driverRoleRules: Record<Role, { read: boolean; write: boolean; delete: boolean }> = {
  Admin: { read: true, write: true, delete: true },
  Dispatcher: { read: true, write: true, delete: false },
  Driver: { read: false, write: false, delete: false },
  Viewer: { read: true, write: false, delete: false },
};

export function resetWarehousesDb(seed: Warehouse[] = []): void {
  warehousesDb.splice(0, warehousesDb.length, ...seed);
}

/** Clears the vehicle store and re-seeds the shared id counter when both stores are empty. */
export function resetVehiclesDb(seed: Vehicle[] = []): void {
  vehiclesDb.splice(0, vehiclesDb.length, ...seed);
  if (warehousesDb.length === 0 && seed.length === 0) nextId = 1;
}

/** Clears the driver store. */
export function resetDriversDb(seed: Driver[] = []): void {
  driversDb.splice(0, driversDb.length, ...seed);
}

/** A route in the mock store — `RouteResponse` is flat, so the row *is* the read model. */
export interface MockRoute {
  id: number;
  name: string;
  plannedStart: string;
  plannedEnd: string;
  /** Nullable FK — a route may be planned unassigned (LOGI-0009 O3). */
  vehicleId: number | null;
  /** Nullable FK — assigned/reassigned via PATCH (LOGI-0009 O3). */
  driverId: number | null;
  status: RouteStatus;
  createdAt: string;
  updatedAt: string | null;
}

export const routesDb: MockRoute[] = [];

/** Clears the route store. */
export function resetRoutesDb(seed: MockRoute[] = []): void {
  routesDb.splice(0, routesDb.length, ...seed);
}

/** Inserts a route into the mock store, mirroring the API defaults (status → Planned, unassigned). */
export function seedRoute(overrides: Partial<MockRoute> = {}): MockRoute {
  const route: MockRoute = {
    id: nextId++,
    name: 'North loop',
    plannedStart: '2026-10-01T08:00:00Z',
    plannedEnd: '2026-10-01T16:00:00Z',
    vehicleId: null,
    driverId: null,
    status: 'Planned',
    createdAt: new Date('2026-09-26T08:00:00Z').toISOString(),
    updatedAt: null,
    ...overrides,
  };
  routesDb.push(route);
  return route;
}

/** A shipment in the mock store: the aggregate row plus its append-only status history. */
export interface MockShipment {
  id: number;
  referenceCode: string;
  originWarehouseId: number;
  destinationAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
  weightKg: number;
  status: ShipmentStatus;
  priority: ShipmentPriority;
  /** BR-1: created_at + 48h (Standard) / +12h (Express); null only for pre-LOGI-0007 seeded data. */
  slaDueAt: string | null;
  /** Set by route assignment (LOGI-0010); null until then. */
  routeId: number | null;
  /** Server-owned creation instant (whole-second ISO8601 UTC). */
  createdAt: string;
  updatedAt: string | null;
  /** Read-time BR-2 `atRisk` is never stored — projected in the GET handler. */
  statusHistory: ShipmentStatusEvent[];
}

export const shipmentsDb: MockShipment[] = [];

/** Separate counter for history event ids so they stay distinct from resource ids. */
let historyCounter = 0;

/**
 * Separate counter for `SHP-######` reference-code digits, seeded from the max shipment id in the
 * store so codes stay unique across resets (AC-5).
 */
let referenceCodeCounter = 0;

/** Clears the shipment store. */
export function resetShipmentsDb(seed: MockShipment[] = []): void {
  shipmentsDb.splice(0, shipmentsDb.length, ...seed);
  historyCounter = 0;
  referenceCodeCounter = shipmentsDb.reduce((max, shipment) => Math.max(max, shipment.id), 0);
}

/** BR-7 legal transitions (mirrors Domain/ShipmentStatus.cs); everything else is 409. */
const shipmentStatuses: ShipmentStatus[] = ['Pending', 'Assigned', 'InTransit', 'Delivered', 'Delayed', 'Cancelled'];

const legalTransitions: Record<ShipmentStatus, ShipmentStatus[]> = {
  Pending: ['Assigned', 'Cancelled'],
  Assigned: ['InTransit', 'Cancelled'],
  InTransit: ['Delivered', 'Delayed'],
  Delayed: ['InTransit'],
  Delivered: [],
  Cancelled: [],
};

/**
 * Shipment transition role rules — the Driver role MAY transition (contract x-roles:
 * [Admin, Dispatcher, Driver]; own-route scoping deferred to LOGI-0009/0010), so this
 * deliberately does NOT reuse roleRules/driverRoleRules.
 */
const shipmentTransitionRules: Record<Role, { read: boolean; write: boolean; delete: boolean }> = {
  Admin: { read: true, write: true, delete: false },
  Dispatcher: { read: true, write: true, delete: false },
  Driver: { read: true, write: true, delete: false },
  Viewer: { read: true, write: false, delete: false },
};

/** Sort keys accepted by GET /shipments (contract enum; default `-createdAt`). */
const shipmentSorts = ['createdAt', '-createdAt', 'slaDueAt', '-slaDueAt'] as const;
type ShipmentSort = (typeof shipmentSorts)[number];
const shipmentPriorities: ShipmentPriority[] = ['Standard', 'Express'];

/** LOGI-0007 AC-10: read Admin/Dispatcher/Viewer (Driver excluded — spec §7 deferral). */
const shipmentListRules: Record<Role, { read: boolean; write: boolean; delete: boolean }> = {
  Admin: { read: true, write: true, delete: false },
  Dispatcher: { read: true, write: true, delete: false },
  // Driver excluded from shipments until own-route scoping (LOGI-0009/0010) — see spec §7.
  Driver: { read: false, write: false, delete: false },
  Viewer: { read: true, write: false, delete: false },
};

/** BR-1: slaDueAt = createdAt + offset(priority) (Standard +48h / Express +12h). */
function slaDueAtFor(createdAtIso: string, priority: ShipmentPriority): string {
  const offsetHours = priority === 'Express' ? 12 : 48;
  return new Date(Date.parse(createdAtIso) + offsetHours * 3_600_000).toISOString();
}

/**
 * BR-2 / AC-9: read-time at-risk projection — whole-second truncation, inclusive threshold
 * `now >= slaDueAt - 2h`, terminal/absent statuses excluded. Never stored.
 */
function computeAtRisk(shipment: MockShipment, nowMs: number): boolean {
  if (shipment.slaDueAt == null) return false;
  if (shipment.status === 'Delivered' || shipment.status === 'Cancelled') return false;
  const dueMs = Math.floor(Date.parse(shipment.slaDueAt) / 1000) * 1000;
  const nowSec = Math.floor(nowMs / 1000) * 1000;
  return nowSec >= dueMs - 2 * 3_600_000;
}

/** Contract read model: the store row minus `statusHistory`, plus the read-time `atRisk`. */
function toShipmentResponse(shipment: MockShipment, atRisk = computeAtRisk(shipment, Date.now())): Shipment {
  return {
    id: shipment.id,
    referenceCode: shipment.referenceCode,
    originWarehouseId: shipment.originWarehouseId,
    destinationAddress: shipment.destinationAddress,
    destinationLat: shipment.destinationLat,
    destinationLng: shipment.destinationLng,
    weightKg: shipment.weightKg,
    status: shipment.status,
    priority: shipment.priority,
    slaDueAt: shipment.slaDueAt,
    routeId: shipment.routeId,
    atRisk,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

/** `SHP-` + six zero-padded digits derived from the next code counter, with a bounded retry. */
function nextShipmentReferenceCode(): string | null {
  // AC-5: the unique index stays the authority; budget exhaustion ⇒ 409 at the call site.
  for (let attempt = 0; attempt < 10; attempt++) {
    referenceCodeCounter += 1;
    const code = `SHP-${String(referenceCodeCounter).padStart(6, '0')}`;
    if (!shipmentsDb.some((shipment) => shipment.referenceCode === code)) return code;
  }
  return null;
}

/** Nullish slaDueAt sorts last in both directions (AC-8). */
function compareNullable(a: string | null, b: string | null, ascending: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return ascending ? a.localeCompare(b) : b.localeCompare(a);
}

/** AC-8 ordering: createdAt/±slaDueAt with a deterministic id tiebreak (descending for `-createdAt`). */
function compareShipments(a: MockShipment, b: MockShipment, sort: ShipmentSort): number {
  const idTiebreak = sort === '-createdAt' ? b.id - a.id : a.id - b.id;
  switch (sort) {
    case 'createdAt':
      return a.createdAt.localeCompare(b.createdAt) || idTiebreak;
    case '-createdAt':
      return b.createdAt.localeCompare(a.createdAt) || idTiebreak;
    case 'slaDueAt':
      return compareNullable(a.slaDueAt, b.slaDueAt, true) || idTiebreak;
    case '-slaDueAt':
      return compareNullable(a.slaDueAt, b.slaDueAt, false) || idTiebreak;
  }
}

function toNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Inserts a shipment into the mock store, seeding the initial history entry (fromStatus null). */
export function seedShipment(overrides: Partial<MockShipment> = {}): MockShipment {
  const id = nextId++;
  const status: ShipmentStatus = overrides.status ?? 'Pending';
  const priority: ShipmentPriority = overrides.priority ?? 'Standard';
  // Whole-second ISO8601 UTC anchor (NFR §8) so read-time atRisk tests compare identical instants.
  const createdAt =
    overrides.createdAt ?? new Date(Math.floor(new Date('2026-09-22T08:00:00Z').getTime() / 1000) * 1000).toISOString();
  const shipment: MockShipment = {
    id,
    // AC-5: ^SHP-[0-9]{6}$ — six zero-padded digits (the old padStart(5) was non-compliant).
    referenceCode: `SHP-${String(id).padStart(6, '0')}`,
    originWarehouseId: 1,
    destinationAddress: '12 Dock Road, Rotterdam',
    destinationLat: null,
    destinationLng: null,
    weightKg: 100,
    status,
    priority,
    slaDueAt: overrides.slaDueAt ?? slaDueAtFor(createdAt, priority),
    routeId: null,
    createdAt,
    updatedAt: null,
    statusHistory: [
      {
        id: ++historyCounter,
        fromStatus: null,
        toStatus: status,
        changedByUserId: 1,
        changedAt: createdAt,
        note: null,
      },
    ],
    ...overrides,
  };
  shipmentsDb.push(shipment);
  referenceCodeCounter = Math.max(referenceCodeCounter, shipment.id);
  return shipment;
}
/** Inserts a driver into the mock store, mirroring the API defaults (status → Active, no createdAt). */
export function seedDriver(overrides: Partial<Driver> = {}): Driver {
  const id = nextId++;
  const driver: Driver = {
    id,
    fullName: 'Raj Patil',
    licenseNumber: `DL-${String(id).padStart(4, '0')}-X`,
    phone: null,
    status: 'Active',
    userId: null,
    ...overrides,
  };
  driversDb.push(driver);
  return driver;
}

/** Inserts a vehicle into the mock store, mirroring the API defaults (status → Available). */
export function seedVehicle(overrides: Partial<Vehicle> = {}): Vehicle {
  const id = nextId++;
  const vehicle: Vehicle = {
    id,
    plateNumber: `RT-${String(id).padStart(4, '0')}-X`,
    type: 'Truck',
    capacityKg: 12000,
    status: 'Available',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  vehiclesDb.push(vehicle);
  return vehicle;
}

/** Clears issued sessions — call alongside resetWarehousesDb in tests. */
export function resetAuthDb(): void {
  sessions.clear();
  sessionCounter = 0;
}

/**
 * Signs a user in directly (bypassing the login request) and returns the token to attach. Tests use
 * this to render the app as a given role without repeating the login flow.
 */
export function seedSession(role: Role = 'Admin'): { token: string; user: AuthUser } {
  const user = mockUsers.find((u) => u.role === role)!;
  const token = `mock-token-${++sessionCounter}`;
  sessions.set(token, user);
  return { token, user };
}

function bearerUser(request: Request): AuthUser | null {
  const header = request.headers.get('Authorization');
  if (header === null || !header.startsWith('Bearer ')) return null;
  return sessions.get(header.slice('Bearer '.length)) ?? null;
}

function problem(
  status: number,
  title: string,
  detail: string,
  errors?: Record<string, string[]>,
): HttpResponse<ProblemDetails> {
  const type =
    status === 404 ? 'not-found' : status === 401 ? 'unauthorized' : status === 403 ? 'forbidden' : 'validation';
  return HttpResponse.json(
    {
      type: `https://logiflow.dev/errors/${type}`,
      title,
      status,
      detail,
      errors,
      traceId: 'msw',
    },
    { status },
  );
}

/** 401 when unauthenticated, 403 when the role is not permitted, `{ user }` when allowed. */
function authorize(
  request: Request,
  operation: 'read' | 'write' | 'delete',
  path: string,
  rules: Record<Role, { read: boolean; write: boolean; delete: boolean }> = roleRules,
): HttpResponse<ProblemDetails> | { user: AuthUser } {
  const user = bearerUser(request);
  if (user === null) {
    return problem(401, 'Unauthorized', 'A valid bearer token is required to access this resource.');
  }
  if (!rules[user.role][operation]) {
    return problem(403, 'Forbidden', `The ${user.role} role is not permitted to ${operation} ${path}.`);
  }
  return { user };
}

/** Creates a warehouse in the mock store (kept from LOGI-0001 for test seeding). */
export function seedWarehouse(partial: Partial<Warehouse> = {}): Warehouse {
  const warehouse: Warehouse = {
    id: nextId++,
    name: 'Central DC',
    address: '12 Industrial Rd',
    latitude: 51.9,
    longitude: 4.5,
    createdAt: new Date('2026-09-18T08:00:00Z').toISOString(),
    ...partial,
  };
  warehousesDb.push(warehouse);
  return warehouse;
}

function validate(body: Partial<WarehouseInput>): Record<string, string[]> | undefined {
  const errors: Record<string, string[]> = {};
  if (!body.name || body.name.trim() === '') errors.name = ['Name is required'];
  else if (body.name.length > 200) errors.name = ['Name must be at most 200 characters'];
  if (!body.address || body.address.trim() === '') errors.address = ['Address is required'];
  else if (body.address.length > 500) errors.address = ['Address must be at most 500 characters'];
  if (body.latitude !== null && body.latitude !== undefined && (body.latitude < -90 || body.latitude > 90))
    errors.latitude = ['Latitude must be between -90 and 90'];
  if (body.longitude !== null && body.longitude !== undefined && (body.longitude < -180 || body.longitude > 180))
    errors.longitude = ['Longitude must be between -180 and 180'];
  return Object.keys(errors).length > 0 ? errors : undefined;
}

const vehicleTypes = ['Van', 'Truck', 'Trailer'];
const vehicleStatuses = ['Available', 'InRoute', 'Maintenance'];

/** Mirrors the CreateVehicleValidator rules (LOGI-0004 AC-2/AC-4/AC-5/AC-6). */
function validateVehicle(body: Partial<VehicleInput>): Record<string, string[]> | undefined {
  const errors: Record<string, string[]> = {};
  if (!body.plateNumber || body.plateNumber.trim() === '') errors.plateNumber = ['Plate number is required'];
  else if (body.plateNumber.length > 20) errors.plateNumber = ['Plate number must be at most 20 characters'];
  if (!body.type || !vehicleTypes.includes(body.type)) errors.type = ['Type must be one of: Van, Truck, Trailer.'];
  if (body.capacityKg === null || body.capacityKg === undefined || body.capacityKg <= 0)
    errors.capacityKg = ['Capacity must be greater than 0'];
  if (body.status !== null && body.status !== undefined && !vehicleStatuses.includes(body.status))
    errors.status = ['Status must be one of: Available, InRoute, Maintenance.'];
  return Object.keys(errors).length > 0 ? errors : undefined;
}

/** 409 for unique-key collisions (duplicate plate), mirroring ConflictException → problem+json. */
function problem409(detail: string): HttpResponse<ProblemDetails> {
  return HttpResponse.json(
    {
      type: 'https://logiflow.dev/errors/conflict',
      title: 'Conflict',
      status: 409,
      detail,
      traceId: 'msw',
    },
    { status: 409 },
  );
}

const driverStatuses = ['Active', 'OffDuty', 'Suspended'];

/** Mirrors the CreateDriverValidator / UpdateDriverValidator rules (LOGI-0005 AC-2..AC-5). */
function validateDriver(body: Partial<DriverInput>): Record<string, string[]> | undefined {
  const errors: Record<string, string[]> = {};
  if (!body.fullName || body.fullName.trim() === '') errors.fullName = ['Full name is required'];
  else if (body.fullName.length > 200) errors.fullName = ['Full name must be at most 200 characters'];
  if (!body.licenseNumber || body.licenseNumber.trim() === '') errors.licenseNumber = ['License number is required'];
  else if (body.licenseNumber.length > 40) errors.licenseNumber = ['License number must be at most 40 characters'];
  if (body.phone !== null && body.phone !== undefined && body.phone.length > 40)
    errors.phone = ['Phone must be at most 40 characters'];
  if (body.status !== null && body.status !== undefined && !driverStatuses.includes(body.status))
    errors.status = ['Status must be one of: Active, OffDuty, Suspended.'];
  return Object.keys(errors).length > 0 ? errors : undefined;
}

/** Route statuses in contract order (RouteResponse.status enum). */
const routeStatuses: RouteStatus[] = ['Planned', 'InProgress', 'Completed', 'Cancelled'];

/**
 * Route role rules — x-roles for /routes: GET [Admin, Dispatcher, Viewer, Driver],
 * POST/PATCH [Admin, Dispatcher] (LOGI-0009 AC-7). The Driver's *read* is additionally
 * scoped to their own routes inside the handlers, because a role whitelist alone cannot
 * express row-level ownership (BR-6).
 */
const routeRoleRules: Record<Role, { read: boolean; write: boolean; delete: boolean }> = {
  Admin: { read: true, write: true, delete: false },
  Dispatcher: { read: true, write: true, delete: false },
  Driver: { read: true, write: false, delete: false },
  Viewer: { read: true, write: false, delete: false },
};

/** The mock's projection of a store row (RouteResponse is flat, so this is a shallow copy). */
function toRouteResponse(route: MockRoute): Route {
  return {
    id: route.id,
    name: route.name,
    plannedStart: route.plannedStart,
    plannedEnd: route.plannedEnd,
    vehicleId: route.vehicleId,
    driverId: route.driverId,
    status: route.status,
    createdAt: route.createdAt,
    updatedAt: route.updatedAt,
  };
}

/**
 * LOGI-0010 AC-8: the BR-5 capacity projection for a route's assigned shipments.
 *
 * `vehicleId`/`capacityKg`/`remainingCapacityKg` are explicitly null (NOT 0) when the route has no
 * vehicle: an unknown capacity is not a full truck, and rendering 0 would tell the dispatcher the
 * route cannot take anything. `remainingCapacityKg` cannot go negative in practice because an
 * over-capacity assign is rejected rather than persisted (AC-2), but it is clamped anyway so the
 * projection never reports a nonsensical negative remainder.
 */
function toRouteCapacityView(route: MockRoute, assignedShipments: MockShipment[]): RouteCapacityView {
  const vehicle =
    route.vehicleId == null ? null : vehiclesDb.find((v) => v.id === route.vehicleId) ?? null;
  const assignedWeightKg = assignedShipments.reduce((sum, s) => sum + s.weightKg, 0);
  if (vehicle == null) {
    return { vehicleId: null, capacityKg: null, assignedWeightKg, remainingCapacityKg: null, shipmentCount: assignedShipments.length };
  }
  return {
    vehicleId: vehicle.id,
    capacityKg: vehicle.capacityKg,
    assignedWeightKg,
    remainingCapacityKg: Math.max(0, vehicle.capacityKg - assignedWeightKg),
    shipmentCount: assignedShipments.length,
  };
}

/** The shipments currently linked to a route, in stable id order (the paged list's source). */
function shipmentsForRoute(routeId: number): MockShipment[] {
  return shipmentsDb.filter((s) => s.routeId === routeId).sort((a, b) => a.id - b.id);
}

/** Whole-second UTC instant, mirroring the backend's Kind=Utc normalization; null when unparseable. */
function toUtcInstant(value: string): string | null {
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(Math.floor(ms / 1000) * 1000).toISOString();
}

/**
 * BR-3/BR-4 (AC-5): two routes conflict only when their planned windows *overlap*
 * (`start < other.end && other.start < end`) and both are non-terminal
 * (Planned/InProgress). Windows that merely touch at the boundary do not conflict.
 */
function windowsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** The first non-terminal route whose window overlaps AND that shares the vehicle/driver (AC-5). */
function findRouteConflict(
  candidateStart: number,
  candidateEnd: number,
  vehicleId: number | null,
  driverId: number | null,
  excludeRouteId: number | null,
): { kind: 'vehicle' | 'driver'; other: MockRoute } | null {
  for (const other of routesDb) {
    if (excludeRouteId != null && other.id === excludeRouteId) continue;
    if (other.status !== 'Planned' && other.status !== 'InProgress') continue;
    const otherStart = Date.parse(other.plannedStart);
    const otherEnd = Date.parse(other.plannedEnd);
    if (!windowsOverlap(candidateStart, candidateEnd, otherStart, otherEnd)) continue;
    if (vehicleId != null && other.vehicleId === vehicleId) return { kind: 'vehicle', other };
    if (driverId != null && other.driverId === driverId) return { kind: 'driver', other };
  }
  return null;
}

/** AC-5: the 409 body must name which assignment collided, and with which route/window. */
function routeConflict(conflict: { kind: 'vehicle' | 'driver'; other: MockRoute }): HttpResponse<ProblemDetails> {
  const label = conflict.kind === 'vehicle' ? 'Vehicle' : 'Driver';
  const id = conflict.kind === 'vehicle' ? conflict.other.vehicleId : conflict.other.driverId;
  return problem409(
    `${label} with id '${String(id)}' is already assigned to route '${conflict.other.name}' ` +
      `(${conflict.other.plannedStart}..${conflict.other.plannedEnd}), whose planned window overlaps.`,
  );
}

/** BR-6 (AC-7): the driver row linked to the caller's account, if any. */
function linkedDriverId(userId: number): number | null {
  return driversDb.find((driver) => driver.userId === userId)?.id ?? null;
}

/** Server-owned keys that must never appear in a route body (AC-10). */
const routeServerOwnedFields = ['id', 'status', 'createdAt', 'updatedAt'] as const;

/** AC-10: rejects any server-owned key present in the body, keyed like the API's field 400s. */
function rejectServerOwnedFields(body: Record<string, unknown>): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const field of routeServerOwnedFields) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      errors[field] = [`The '${field}' field is server-owned and must not be supplied.`];
    }
  }
  return errors;
}

/** Parses an optional vehicleId/driverId: null/undefined → unassigned, else a positive integer. */
function parseOptionalId(value: unknown): { id: number | null; error?: string } {
  if (value === null || value === undefined) return { id: null };
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return { id: null, error: 'Must be an integer greater than or equal to 1, or null.' };
  }
  return { id: value };
}

export const handlers = [
  // ---------------------------------------------------------------- Auth (LOGI-0003)

  http.post('/api/v1/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email?: string; password?: string };

    // Shape validation first (400), matching the backend validator and the contract.
    const errors: Record<string, string[]> = {};
    if (!body.email || body.email.trim() === '') errors.email = ['Email is required'];
    else if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(body.email)) errors.email = ['Enter a valid email address'];
    else if (body.email.length > 256) errors.email = ['Email must be at most 256 characters'];
    if (!body.password || body.password === '') errors.password = ['Password is required'];
    else if (body.password.length > 128) errors.password = ['Password must be at most 128 characters'];
    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    const user = mockUsers.find((u) => u.email.toLowerCase() === body.email!.trim().toLowerCase());
    // Identical failure for unknown email and wrong password (anti-enumeration, AC-2).
    if (user === undefined || body.password !== mockPassword) {
      return problem(401, 'Unauthorized', 'Invalid email or password.');
    }

    const accessToken = `mock-token-${++sessionCounter}`;
    sessions.set(accessToken, user);
    return HttpResponse.json({
      accessToken,
      refreshToken: `mock-refresh-${sessionCounter}`,
      expiresIn: 900,
      user,
    });
  }),

  http.post('/api/v1/auth/refresh', async ({ request }) => {
    const body = (await request.json()) as { refreshToken?: string };
    if (!body.refreshToken) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
        refreshToken: ['Refresh token is required'],
      });
    }
    // The mock does not implement rotation; an unknown token is rejected like an expired one.
    return problem(401, 'Unauthorized', 'The refresh token is invalid or has expired.');
  }),

  http.post('/api/v1/auth/logout', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/v1/auth/me', ({ request }) => {
    const user = bearerUser(request);
    return user === null
      ? problem(401, 'Unauthorized', 'A valid bearer token is required to access this resource.')
      : HttpResponse.json(user);
  }),

  // ---------------------------------------------------------------- Warehouses (LOGI-0001)

  http.get('/api/v1/warehouses', ({ request }) => {
    const auth = authorize(request, 'read', 'warehouses');
    if (!('user' in auth)) return auth;

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')));
    const q = (url.searchParams.get('q') ?? '').toLowerCase();

    const filtered = warehousesDb.filter((w) => q === '' || w.name.toLowerCase().includes(q));
    const totalCount = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json({
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  }),

  http.get('/api/v1/warehouses/:id', ({ request, params }) => {
    const auth = authorize(request, 'read', 'warehouses');
    if (!('user' in auth)) return auth;

    const warehouse = warehousesDb.find((w) => w.id === Number(params.id));
    return warehouse
      ? HttpResponse.json(warehouse)
      : problem(404, 'Resource not found', `Warehouse with id '${String(params.id)}' was not found.`);
  }),

  http.post('/api/v1/warehouses', async ({ request }) => {
    const auth = authorize(request, 'write', 'warehouses');
    if (!('user' in auth)) return auth;

    const body = (await request.json()) as WarehouseInput;
    const errors = validate(body);
    if (errors) return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);

    const created: Warehouse = {
      id: nextId++,
      name: body.name.trim(),
      address: body.address.trim(),
      latitude: body.latitude ?? null,
      longitude: body.longitude ?? null,
      createdAt: new Date().toISOString(),
    };
    warehousesDb.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put('/api/v1/warehouses/:id', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'warehouses');
    if (!('user' in auth)) return auth;

    const warehouse = warehousesDb.find((w) => w.id === Number(params.id));
    if (!warehouse) return problem(404, 'Resource not found', `Warehouse with id '${String(params.id)}' was not found.`);

    const body = (await request.json()) as WarehouseInput;
    const errors = validate(body);
    if (errors) return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);

    warehouse.name = body.name.trim();
    warehouse.address = body.address.trim();
    warehouse.latitude = body.latitude ?? null;
    warehouse.longitude = body.longitude ?? null;
    return HttpResponse.json(warehouse);
  }),

  http.delete('/api/v1/warehouses/:id', ({ request, params }) => {
    const auth = authorize(request, 'delete', 'warehouses');
    if (!('user' in auth)) return auth;

    const index = warehousesDb.findIndex((w) => w.id === Number(params.id));
    if (index === -1) return problem(404, 'Resource not found', `Warehouse with id '${String(params.id)}' was not found.`);
    warehousesDb.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ---------------------------------------------------------------- Vehicles (LOGI-0004)

  http.get('/api/v1/vehicles', ({ request }) => {
    const auth = authorize(request, 'read', 'vehicles');
    if (!('user' in auth)) return auth;

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')));
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const status = url.searchParams.get('status');
    const type = url.searchParams.get('type');

    const filtered = vehiclesDb.filter(
      (v) =>
        (q === '' || v.plateNumber.toLowerCase().includes(q)) &&
        (status === null || status === '' || v.status === status) &&
        (type === null || type === '' || v.type === type),
    );
    const totalCount = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json({
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  }),

  http.get('/api/v1/vehicles/:id', ({ request, params }) => {
    const auth = authorize(request, 'read', 'vehicles');
    if (!('user' in auth)) return auth;

    const vehicle = vehiclesDb.find((v) => v.id === Number(params.id));
    return vehicle
      ? HttpResponse.json(vehicle)
      : problem(404, 'Resource not found', `Vehicle with id '${String(params.id)}' was not found.`);
  }),

  http.post('/api/v1/vehicles', async ({ request }) => {
    const auth = authorize(request, 'write', 'vehicles');
    if (!('user' in auth)) return auth;

    const body = (await request.json()) as VehicleInput;
    const errors = validateVehicle(body);
    if (errors) return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);

    const plate = body.plateNumber.trim();
    if (vehiclesDb.some((v) => v.plateNumber === plate)) {
      return problem409(`Vehicle with key '${plate}' already exists.`);
    }

    const created: Vehicle = {
      id: nextId++,
      plateNumber: plate,
      type: body.type,
      capacityKg: body.capacityKg,
      status: body.status ?? 'Available',
      createdAt: new Date().toISOString(),
    };
    vehiclesDb.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put('/api/v1/vehicles/:id', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'vehicles');
    if (!('user' in auth)) return auth;

    const vehicle = vehiclesDb.find((v) => v.id === Number(params.id));
    if (!vehicle) return problem(404, 'Resource not found', `Vehicle with id '${String(params.id)}' was not found.`);

    const body = (await request.json()) as VehicleInput;
    const errors = validateVehicle(body);
    if (errors) return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);

    const plate = body.plateNumber.trim();
    if (vehiclesDb.some((v) => v.id !== vehicle.id && v.plateNumber === plate)) {
      return problem409(`Vehicle with key '${plate}' already exists.`);
    }

    vehicle.plateNumber = plate;
    vehicle.type = body.type;
    vehicle.capacityKg = body.capacityKg;
    vehicle.status = body.status ?? 'Available';
    return HttpResponse.json(vehicle);
  }),

  http.delete('/api/v1/vehicles/:id', ({ request, params }) => {
    const auth = authorize(request, 'delete', 'vehicles');
    if (!('user' in auth)) return auth;

    const index = vehiclesDb.findIndex((v) => v.id === Number(params.id));
    if (index === -1) return problem(404, 'Resource not found', `Vehicle with id '${String(params.id)}' was not found.`);
    // AC-8: the deferred delete-when-referenced 409 goes live now that routes.vehicle_id exists.
    const referencing = routesDb.find((route) => route.vehicleId === Number(params.id));
    if (referencing) {
      return problem409(
        `Vehicle with id '${String(params.id)}' is referenced by route '${referencing.name}' (id ${referencing.id}) and cannot be deleted.`,
      );
    }
    vehiclesDb.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // ---------------------------------------------------------------- Drivers (LOGI-0005)

  http.get('/api/v1/drivers', ({ request }) => {
    const auth = authorize(request, 'read', 'drivers', driverRoleRules);
    if (!('user' in auth)) return auth;

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')));
    const q = (url.searchParams.get('q') ?? '').toLowerCase();
    const status = url.searchParams.get('status');

    const filtered = driversDb.filter(
      (d) =>
        (q === '' || d.fullName.toLowerCase().includes(q)) &&
        (status === null || status === '' || d.status === status),
    );
    const totalCount = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    return HttpResponse.json({
      items,
      page,
      pageSize,
      totalCount,
      totalPages: Math.ceil(totalCount / pageSize),
    });
  }),

  http.get('/api/v1/drivers/:id', ({ request, params }) => {
    const auth = authorize(request, 'read', 'drivers', driverRoleRules);
    if (!('user' in auth)) return auth;

    const driver = driversDb.find((d) => d.id === Number(params.id));
    return driver
      ? HttpResponse.json(driver)
      : problem(404, 'Resource not found', `Driver with id '${String(params.id)}' was not found.`);
  }),

  http.post('/api/v1/drivers', async ({ request }) => {
    const auth = authorize(request, 'write', 'drivers', driverRoleRules);
    if (!('user' in auth)) return auth;

    const body = (await request.json()) as DriverInput;
    const errors = validateDriver(body);
    if (errors) return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);

    const license = body.licenseNumber.trim();
    if (driversDb.some((d) => d.licenseNumber === license)) {
      return problem409(`Driver with key '${license}' already exists.`);
    }

    // AC-5/6: nonexistent user (400) is checked before the 1:1 rule (409).
    if (body.userId != null) {
      const existingUser = mockUsers.find((u) => u.id === body.userId);
      if (existingUser === undefined) {
        return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
          userId: [`User with id '${body.userId}' was not found.`],
        });
      }
      if (driversDb.some((d) => d.userId === body.userId)) {
        return problem409(`User with id '${body.userId}' is already linked to a driver.`);
      }
    }

    const created: Driver = {
      id: nextId++,
      fullName: body.fullName.trim(),
      licenseNumber: license,
      phone: body.phone ?? null,
      status: body.status ?? 'Active',
      userId: body.userId ?? null,
    };
    driversDb.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  http.put('/api/v1/drivers/:id', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'drivers', driverRoleRules);
    if (!('user' in auth)) return auth;

    const driver = driversDb.find((d) => d.id === Number(params.id));
    if (!driver) return problem(404, 'Resource not found', `Driver with id '${String(params.id)}' was not found.`);

    const body = (await request.json()) as DriverInput;
    const errors = validateDriver(body);
    if (errors) return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);

    const license = body.licenseNumber.trim();
    if (driversDb.some((d) => d.id !== driver.id && d.licenseNumber === license)) {
      return problem409(`Driver with key '${license}' already exists.`);
    }

    if (body.userId != null) {
      const existingUser = mockUsers.find((u) => u.id === body.userId);
      if (existingUser === undefined) {
        return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
          userId: [`User with id '${body.userId}' was not found.`],
        });
      }
      if (driversDb.some((d) => d.id !== driver.id && d.userId === body.userId)) {
        return problem409(`User with id '${body.userId}' is already linked to a driver.`);
      }
    }

    driver.fullName = body.fullName.trim();
    driver.licenseNumber = license;
    driver.phone = body.phone ?? null;
    driver.status = body.status ?? 'Active';
    // userId null/omitted clears the link (full update semantics).
    driver.userId = body.userId ?? null;
    return HttpResponse.json(driver);
  }),

  http.delete('/api/v1/drivers/:id', ({ request, params }) => {
    const auth = authorize(request, 'delete', 'drivers', driverRoleRules);
    if (!('user' in auth)) return auth;

    const index = driversDb.findIndex((d) => d.id === Number(params.id));
    if (index === -1) return problem(404, 'Resource not found', `Driver with id '${String(params.id)}' was not found.`);
    // AC-8: the deferred delete-when-referenced 409 goes live now that routes.driver_id exists.
    const referencing = routesDb.find((route) => route.driverId === Number(params.id));
    if (referencing) {
      return problem409(
        `Driver with id '${String(params.id)}' is referenced by route '${referencing.name}' (id ${referencing.id}) and cannot be deleted.`,
      );
    }
    driversDb.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

    // ------------------------------------- Shipments: create + list (LOGI-0007)

  /** GET /shipments — AC-6..AC-10: paged envelope, AND filters, 4 sorts, read-time atRisk. */
  http.get('/api/v1/shipments', ({ request }) => {
    const auth = authorize(request, 'read', 'shipments', shipmentListRules);
    if (!('user' in auth)) return auth;

    const url = new URL(request.url);
    const errors: Record<string, string[]> = {};

    const pageRaw = url.searchParams.get('page');
    const page = pageRaw == null ? 1 : Number(pageRaw);
    if (pageRaw != null && (!Number.isInteger(page) || page < 1)) {
      errors.page = ['Page must be an integer greater than or equal to 1.'];
    }
    const pageSizeRaw = url.searchParams.get('pageSize');
    const pageSize = pageSizeRaw == null ? 25 : Number(pageSizeRaw);
    if (pageSizeRaw != null && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      errors.pageSize = ['Page size must be an integer between 1 and 100.'];
    }

    const statusRaw = url.searchParams.get('status');
    if (statusRaw != null && !shipmentStatuses.includes(statusRaw as ShipmentStatus)) {
      errors.status = ['Status must be one of: Pending, Assigned, InTransit, Delivered, Delayed, Cancelled.'];
    }
    const priorityRaw = url.searchParams.get('priority');
    if (priorityRaw != null && !shipmentPriorities.includes(priorityRaw as ShipmentPriority)) {
      errors.priority = ['Priority must be one of: Standard, Express.'];
    }
    const slaRiskRaw = url.searchParams.get('slaRisk');
    if (slaRiskRaw != null && slaRiskRaw !== 'true' && slaRiskRaw !== 'false') {
      errors.slaRisk = ['slaRisk must be true or false.'];
    }
    const sortRaw = url.searchParams.get('sort');
    const sort = (sortRaw ?? '-createdAt') as ShipmentSort;
    if (sortRaw != null && !shipmentSorts.includes(sort)) {
      errors.sort = ['Sort must be one of: createdAt, -createdAt, slaDueAt, -slaDueAt.'];
    }
    const originRaw = url.searchParams.get('originWarehouseId');
    const originWarehouseId = originRaw == null ? null : Number(originRaw);
    if (originRaw != null && (originWarehouseId == null || !Number.isInteger(originWarehouseId) || originWarehouseId < 1)) {
      errors.originWarehouseId = ['originWarehouseId must be an integer greater than or equal to 1.'];
    }

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    // Read-time BR-2 projection (never stored) — computed once per request.
    const now = Date.now();
    const qRaw = url.searchParams.get('q');
    const qNeedle = qRaw == null ? null : qRaw.toLowerCase();

    let rows = shipmentsDb
      .map((shipment) => ({ shipment, atRisk: computeAtRisk(shipment, now) }))
      .filter(
        ({ shipment, atRisk }) =>
          (statusRaw == null || shipment.status === statusRaw) &&
          (priorityRaw == null || shipment.priority === priorityRaw) &&
          (originWarehouseId == null || shipment.originWarehouseId === originWarehouseId) &&
          (slaRiskRaw == null || atRisk === (slaRiskRaw === 'true')) &&
          (qNeedle == null ||
            shipment.referenceCode.toLowerCase().includes(qNeedle) ||
            shipment.destinationAddress.toLowerCase().includes(qNeedle)),
      );

    rows.sort((a, b) => compareShipments(a.shipment, b.shipment, sort));

    const totalCount = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const start = (page - 1) * pageSize;
    const items = rows
      .slice(start, start + pageSize)
      .map(({ shipment, atRisk }) => toShipmentResponse(shipment, atRisk));

    return HttpResponse.json({ items, page, pageSize, totalCount, totalPages });
  }),


  /** POST /shipments — AC-1..AC-5/AC-10: server-owned code/status/slaDueAt, field-keyed 400s. */
  http.post('/api/v1/shipments', async ({ request }) => {
    const auth = authorize(request, 'write', 'shipments', shipmentListRules);
    if (!('user' in auth)) return auth;

    const body = (await request.json()) as Partial<ShipmentInput>;
    const errors: Record<string, string[]> = {};

    const weightRaw = body.weightKg;
    const weightKg = typeof weightRaw === 'number' ? weightRaw : Number(weightRaw);
    if (weightRaw == null || !Number.isFinite(weightKg) || weightKg <= 0) {
      errors.weightKg = ['Weight must be greater than 0'];
    }

    const destinationAddress =
      typeof body.destinationAddress === 'string' ? body.destinationAddress.trim() : '';
    if (destinationAddress === '') errors.destinationAddress = ['Destination address is required'];
    else if (destinationAddress.length > 500)
      errors.destinationAddress = ['Destination address must be at most 500 characters'];

    const originWarehouseId = Number(body.originWarehouseId);
    if (body.originWarehouseId == null || !Number.isInteger(originWarehouseId) || originWarehouseId < 1) {
      errors.originWarehouseId = ['Origin warehouse id is required'];
    } else if (!warehousesDb.some((warehouse) => warehouse.id === originWarehouseId)) {
      errors.originWarehouseId = [`Warehouse with id '${originWarehouseId}' does not exist.`];
    }

    // BR-1 rule 1.3/1.7: omitted/null → Standard; anything else fails loudly with allowed values.
    let priority: ShipmentPriority = 'Standard';
    if (body.priority != null) {
      const raw = typeof body.priority === 'string' ? body.priority.trim() : '';
      if (raw === 'Standard' || raw === 'Express') priority = raw;
      else errors.priority = ['Priority must be one of: Standard, Express.'];
    }

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    const referenceCode = nextShipmentReferenceCode();
    if (referenceCode == null) {
      return problem409('Reference code generation exhausted its retry budget; please retry.');
    }

    // Server-owned instants, whole-second UTC per NFR §8; BR-1 slaDueAt = createdAt + offset.
    const createdAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    const slaDueAt = slaDueAtFor(createdAt, priority);

    const id = nextId++;
    const shipment: MockShipment = {
      id,
      referenceCode,
      originWarehouseId,
      destinationAddress,
      destinationLat: toNullableNumber(body.destinationLat),
      destinationLng: toNullableNumber(body.destinationLng),
      weightKg,
      status: 'Pending',
      priority,
      slaDueAt,
      routeId: null,
      createdAt,
      updatedAt: null,
      statusHistory: [
        {
          id: ++historyCounter,
          fromStatus: null,
          toStatus: 'Pending',
          changedByUserId: auth.user.id,
          changedAt: createdAt,
          note: null,
        },
      ],
    };
    shipmentsDb.push(shipment);
    referenceCodeCounter = Math.max(referenceCodeCounter, id);
    return HttpResponse.json(toShipmentResponse(shipment), { status: 201 });
  }),

  // ------------------------- Shipments: detail + edit (LOGI-0008 AC-1..AC-7)

  /**
   * GET /shipments/{id} — the detail read LOGI-0007 deferred here. Same `ShipmentResponse` shape as
   * a list row (including the read-time atRisk projection and routeId); 404 for an unknown id.
   * Roles: x-roles [Admin, Dispatcher, Viewer] — Driver excluded (own-route scoping is LOGI-0009/0010).
   */
  http.get('/api/v1/shipments/:id', ({ request, params }) => {
    const auth = authorize(request, 'read', 'shipments', shipmentListRules);
    if (!('user' in auth)) return auth;

    const shipment = shipmentsDb.find((s) => s.id === Number(params.id));
    if (!shipment) return problem(404, 'Resource not found', `Shipment with id '${String(params.id)}' was not found.`);
    return HttpResponse.json(toShipmentResponse(shipment));
  }),

  /**
   * PATCH /shipments/{id} — AC-1..AC-5/AC-12. A *partial* update of a Pending shipment:
   *  - 404 unknown id; 409 when the status is no longer Pending, with nothing written (AC-2);
   *  - field-keyed 400s mirroring the backend validator (AC-3), including the warehouse-existence
   *    check and the `body` key for an empty patch;
   *  - server-owned and immutable keys are rejected per field, and `priority` is rejected outright
   *    (AC-4) so BR-1 keeps its single sla_due_at writer;
   *  - no status-history row is written — an edit is not a status transition (AC-1) — and
   *    `priority`/`slaDueAt`/`referenceCode`/`createdAt` are never touched.
   */
  http.patch('/api/v1/shipments/:id', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'shipments', shipmentListRules);
    if (!('user' in auth)) return auth;

    const shipment = shipmentsDb.find((s) => s.id === Number(params.id));
    if (!shipment) return problem(404, 'Resource not found', `Shipment with id '${String(params.id)}' was not found.`);

    // AC-2: the state guard comes first, so a stale client learns why nothing was applied.
    if (shipment.status !== 'Pending') {
      return problem409(
        `Shipment ${shipment.referenceCode} is in status '${shipment.status}' and can no longer be edited. Required status: 'Pending'.`,
      );
    }

    const raw = (await request.json()) as Record<string, unknown>;
    const errors: Record<string, string[]> = {};

    // AC-4: server-owned keys are never accepted; each is reported under its own name.
    for (const key of ['id', 'referenceCode', 'status', 'slaDueAt', 'createdAt', 'updatedAt', 'routeId', 'atRisk']) {
      if (key in raw) errors[key] = [`'${key}' is a server-owned field and cannot be set.`];
    }
    if ('priority' in raw) {
      errors.priority = ['Priority is immutable; create a new shipment.'];
    }
    if (Object.keys(raw).length === 0) {
      errors.body = ['At least one editable field is required.'];
    }

    const has = (key: string) => key in raw;
    const patch: Record<string, unknown> = {};

    if (has('originWarehouseId')) {
      const originWarehouseId = Number(raw.originWarehouseId);
      if (!Number.isInteger(originWarehouseId) || originWarehouseId < 1) {
        errors.originWarehouseId = ['Origin warehouse id is required'];
      } else if (!warehousesDb.some((warehouse) => warehouse.id === originWarehouseId)) {
        errors.originWarehouseId = [`Warehouse with id '${originWarehouseId}' does not exist.`];
      } else {
        patch.originWarehouseId = originWarehouseId;
      }
    }

    if (has('destinationAddress')) {
      const address = typeof raw.destinationAddress === 'string' ? raw.destinationAddress.trim() : '';
      if (address === '') errors.destinationAddress = ['Destination address is required'];
      else if (address.length > 500)
        errors.destinationAddress = ['Destination address must be at most 500 characters'];
      else patch.destinationAddress = address;
    }

    if (has('weightKg')) {
      const weightKg = Number(raw.weightKg);
      if (raw.weightKg == null || !Number.isFinite(weightKg) || weightKg <= 0) {
        errors.weightKg = ['Weight must be greater than 0'];
      } else {
        patch.weightKg = weightKg;
      }
    }

    if (has('destinationLat')) {
      if (raw.destinationLat == null) {
        patch.destinationLat = null;
      } else {
        const lat = Number(raw.destinationLat);
        if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
          errors.destinationLat = ['Destination latitude must be between -90 and 90.'];
        } else {
          patch.destinationLat = lat;
        }
      }
    }

    if (has('destinationLng')) {
      if (raw.destinationLng == null) {
        patch.destinationLng = null;
      } else {
        const lng = Number(raw.destinationLng);
        if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
          errors.destinationLng = ['Destination longitude must be between -180 and 180.'];
        } else {
          patch.destinationLng = lng;
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    Object.assign(shipment, patch);
    shipment.updatedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    return HttpResponse.json(toShipmentResponse(shipment));
  }),

  // ------------------------------------- Shipments: BR-7 status lifecycle (LOGI-0006)

  /**
   * POST /shipments/{id}/status-transitions — transitions the shipment and appends the audit
   * event in one step (single-transaction semantics). Illegal BR-7 jumps → 409 whose detail
   * names the legal next state(s); rejected attempts record nothing (AC-2/3/4).
   */
  http.post('/api/v1/shipments/:id/status-transitions', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'shipments', shipmentTransitionRules);
    if (!('user' in auth)) return auth;

    const shipment = shipmentsDb.find((s) => s.id === Number(params.id));
    if (!shipment) return problem(404, 'Resource not found', `Shipment with id '${String(params.id)}' was not found.`);

    const body = (await request.json()) as StatusTransitionRequest;

    // LOGI-0008 AC-10 (BR-6): cancelling is Admin/Dispatcher-only. Checked before the transition
    // table so a Driver's rejected attempt writes nothing; a Driver's non-terminal transition
    // (e.g. Assigned → InTransit) is still 2xx, i.e. the LOGI-0006 behaviour is unchanged.
    if (body.toStatus === 'Cancelled' && auth.user.role === 'Driver') {
      return problem(403, 'Forbidden', `The ${auth.user.role} role is not permitted to cancel shipments.`);
    }

    if (!body.toStatus || !shipmentStatuses.includes(body.toStatus)) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
        toStatus: ['Status must be one of: Pending, Assigned, InTransit, Delivered, Delayed, Cancelled.'],
      });
    }
    if (body.note != null && body.note.length > 500) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
        note: ['Note must be at most 500 characters'],
      });
    }

    const legal = legalTransitions[shipment.status];
    if (!legal.includes(body.toStatus)) {
      const next = legal.length > 0 ? legal.join(', ') : 'none';
      return problem409(
        `Cannot transition shipment from '${shipment.status}' to '${body.toStatus}'. Legal next state(s): ${next}.`,
      );
    }

    const event: ShipmentStatusEvent = {
      id: ++historyCounter,
      fromStatus: shipment.status,
      toStatus: body.toStatus,
      changedByUserId: auth.user.id,
      changedAt: new Date().toISOString(),
      note: body.note ?? null,
    };
    shipment.status = body.toStatus;
    shipment.statusHistory.push(event);
    return HttpResponse.json(event);
  }),

  /** GET /shipments/{id}/status-history — paged, oldest first (AC-7); every role may read (AC-8). */
  http.get('/api/v1/shipments/:id/status-history', ({ request, params }) => {
    const auth = authorize(request, 'read', 'shipments', shipmentTransitionRules);
    if (!('user' in auth)) return auth;

    const shipment = shipmentsDb.find((s) => s.id === Number(params.id));
    if (!shipment) return problem(404, 'Resource not found', `Shipment with id '${String(params.id)}' was not found.`);

    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(url.searchParams.get('pageSize') ?? '25')));
    const items = shipment.statusHistory.slice((page - 1) * pageSize, page * pageSize);
    return HttpResponse.json({
      items,
      page,
      pageSize,
      totalCount: shipment.statusHistory.length,
      totalPages: Math.max(1, Math.ceil(shipment.statusHistory.length / pageSize)),
    });
  }),

  // ------------------------------------------------------- Routes (LOGI-0009 AC-1..AC-10)

  /**
   * GET /routes — AC-9: paged envelope, AND filters (status/vehicleId/driverId/q), q is a
   * case-insensitive name contains, sort fixed to `-createdAt` with an id tiebreak (the
   * contract exposes no sort parameter for routes). AC-7/BR-6: a Driver caller sees only the
   * routes assigned to their linked driver row.
   */
  http.get('/api/v1/routes', ({ request }) => {
    const auth = authorize(request, 'read', 'routes', routeRoleRules);
    if (!('user' in auth)) return auth;

    const url = new URL(request.url);
    const errors: Record<string, string[]> = {};

    const pageRaw = url.searchParams.get('page');
    const page = pageRaw == null ? 1 : Number(pageRaw);
    if (pageRaw != null && (!Number.isInteger(page) || page < 1)) {
      errors.page = ['Page must be an integer greater than or equal to 1.'];
    }
    const pageSizeRaw = url.searchParams.get('pageSize');
    const pageSize = pageSizeRaw == null ? 25 : Number(pageSizeRaw);
    if (pageSizeRaw != null && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      errors.pageSize = ['Page size must be an integer between 1 and 100.'];
    }

    const statusRaw = url.searchParams.get('status');
    if (statusRaw != null && !routeStatuses.includes(statusRaw as RouteStatus)) {
      errors.status = ['Status must be one of: Planned, InProgress, Completed, Cancelled.'];
    }
    const vehicleIdRaw = url.searchParams.get('vehicleId');
    const vehicleId = vehicleIdRaw == null ? null : Number(vehicleIdRaw);
    if (vehicleIdRaw != null && (!Number.isInteger(vehicleId) || vehicleId! < 1)) {
      errors.vehicleId = ['vehicleId must be an integer greater than or equal to 1.'];
    }
    const driverIdRaw = url.searchParams.get('driverId');
    const driverId = driverIdRaw == null ? null : Number(driverIdRaw);
    if (driverIdRaw != null && (!Number.isInteger(driverId) || driverId! < 1)) {
      errors.driverId = ['driverId must be an integer greater than or equal to 1.'];
    }

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    // AC-7: Driver callers are scoped to their own routes; a Driver with no linked driver row
    // therefore sees an empty page rather than the whole fleet's plan.
    const isDriver = auth.user.role === 'Driver';
    const ownDriverId = isDriver ? linkedDriverId(auth.user.id) : null;
    const qRaw = url.searchParams.get('q');
    const qNeedle = qRaw == null ? null : qRaw.toLowerCase();

    const rows = routesDb
      .filter(
        (route) =>
          (statusRaw == null || route.status === statusRaw) &&
          (vehicleId == null || route.vehicleId === vehicleId) &&
          (driverId == null || route.driverId === driverId) &&
          // A Driver with no linked driver row owns nothing — least of all unassigned routes.
          (!isDriver || (ownDriverId != null && route.driverId === ownDriverId)) &&
          (qNeedle == null || route.name.toLowerCase().includes(qNeedle)),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id - a.id);

    const totalCount = rows.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const start = (page - 1) * pageSize;
    const items = rows.slice(start, start + pageSize).map(toRouteResponse);

    return HttpResponse.json({ items, page, pageSize, totalCount, totalPages });
  }),

  /**
   * POST /routes — AC-1..AC-5/AC-10: create a route in status Planned. name plus the planned
   * window are required (plannedEnd after plannedStart); vehicleId/driverId are optional
   * (omitted or explicit null → the unassigned lane). A dangling vehicleId/driverId is a 404
   * (O1); double-booking an overlapping window is a 409 (O2, BR-3/BR-4). No shipment is
   * touched — shipment→route assignment is LOGI-0010.
   */
  http.post('/api/v1/routes', async ({ request }) => {
    const auth = authorize(request, 'write', 'routes', routeRoleRules);
    if (!('user' in auth)) return auth;

    const raw = (await request.json()) as Record<string, unknown>;
    const errors: Record<string, string[]> = { ...rejectServerOwnedFields(raw) };

    const name = typeof raw.name === 'string' ? raw.name.trim() : '';
    if (name === '') errors.name = ['Name is required'];
    else if (name.length > 200) errors.name = ['Name must be at most 200 characters'];

    const plannedStartRaw = typeof raw.plannedStart === 'string' ? raw.plannedStart : '';
    const plannedEndRaw = typeof raw.plannedEnd === 'string' ? raw.plannedEnd : '';
    const plannedStart = plannedStartRaw === '' ? null : toUtcInstant(plannedStartRaw);
    const plannedEnd = plannedEndRaw === '' ? null : toUtcInstant(plannedEndRaw);

    if (plannedStartRaw === '') errors.plannedStart = ['Planned start is required'];
    else if (plannedStart == null) errors.plannedStart = ['Planned start must be a valid date-time'];
    if (plannedEndRaw === '') errors.plannedEnd = ['Planned end is required'];
    else if (plannedEnd == null) errors.plannedEnd = ['Planned end must be a valid date-time'];
    if (
      plannedStart != null &&
      plannedEnd != null &&
      Date.parse(plannedEnd) <= Date.parse(plannedStart)
    ) {
      errors.plannedEnd = ['Planned end must be after planned start'];
    }

    const vehicle = parseOptionalId(raw.vehicleId);
    if (vehicle.error) errors.vehicleId = [vehicle.error];
    const driver = parseOptionalId(raw.driverId);
    if (driver.error) errors.driverId = [driver.error];

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    // O1: a dangling FK reads as "referenced resource does not exist" → 404 (contract precedent).
    if (vehicle.id != null && !vehiclesDb.some((v) => v.id === vehicle.id)) {
      return problem(404, 'Resource not found', `Vehicle with id '${vehicle.id}' was not found.`);
    }
    if (driver.id != null && !driversDb.some((d) => d.id === driver.id)) {
      return problem(404, 'Resource not found', `Driver with id '${driver.id}' was not found.`);
    }

    // BR-3/BR-4 (AC-5): the overlap guard runs before any write, so a rejected create leaves no row.
    const conflict = findRouteConflict(
      Date.parse(plannedStart!),
      Date.parse(plannedEnd!),
      vehicle.id,
      driver.id,
      null,
    );
    if (conflict) return routeConflict(conflict);

    const route: MockRoute = {
      id: nextId++,
      name,
      plannedStart: plannedStart!,
      plannedEnd: plannedEnd!,
      vehicleId: vehicle.id,
      driverId: driver.id,
      status: 'Planned',
      createdAt: new Date(Math.floor(Date.now() / 1000) * 1000).toISOString(),
      updatedAt: null,
    };
    routesDb.push(route);
    return HttpResponse.json(toRouteResponse(route), { status: 201 });
  }),

  /**
   * GET /routes/{id} — AC-4: 404 for an unknown id. AC-7/BR-6: a Driver token for another
   * driver's route is 403 (existence is checked first, so an unknown id stays a 404).
   */
  http.get('/api/v1/routes/:id', ({ request, params }) => {
    const auth = authorize(request, 'read', 'routes', routeRoleRules);
    if (!('user' in auth)) return auth;

    const route = routesDb.find((r) => r.id === Number(params.id));
    if (!route) return problem(404, 'Resource not found', `Route with id '${String(params.id)}' was not found.`);

    if (auth.user.role === 'Driver' && route.driverId !== linkedDriverId(auth.user.id)) {
      return problem(403, 'Forbidden', 'The Driver role is not permitted to read routes assigned to another driver.');
    }

    return HttpResponse.json(toRouteResponse(route));
  }),

  /**
   * PATCH /routes/{id} — AC-2..AC-6/AC-10: rename / reschedule / assign / reassign / unassign.
   * Explicit null unassigns; an empty body is a 400 (errors.body); server-owned keys are 400s;
   * a non-Planned route is a 409 naming the required status. The store row is mutated only
   * after every guard has passed, so a rejected PATCH leaves the row byte-identical.
   */
  http.patch('/api/v1/routes/:id', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'routes', routeRoleRules);
    if (!('user' in auth)) return auth;

    const route = routesDb.find((r) => r.id === Number(params.id));
    if (!route) return problem(404, 'Resource not found', `Route with id '${String(params.id)}' was not found.`);

    const raw = (await request.json()) as Record<string, unknown>;
    const errors: Record<string, string[]> = { ...rejectServerOwnedFields(raw) };

    const has = (key: string) => Object.prototype.hasOwnProperty.call(raw, key);
    const editable = ['name', 'plannedStart', 'plannedEnd', 'vehicleId', 'driverId'].filter(has);
    if (editable.length === 0 && Object.keys(errors).length === 0) {
      errors.body = ['At least one field is required.'];
    }

    let name = route.name;
    if (has('name')) {
      const candidate = typeof raw.name === 'string' ? raw.name.trim() : '';
      if (candidate === '') errors.name = ['Name is required'];
      else if (candidate.length > 200) errors.name = ['Name must be at most 200 characters'];
      else name = candidate;
    }

    let plannedStart = route.plannedStart;
    if (has('plannedStart')) {
      const candidate = typeof raw.plannedStart === 'string' ? raw.plannedStart : '';
      const parsed = candidate === '' ? null : toUtcInstant(candidate);
      if (parsed == null) errors.plannedStart = ['Planned start must be a valid date-time'];
      else plannedStart = parsed;
    }

    let plannedEnd = route.plannedEnd;
    if (has('plannedEnd')) {
      const candidate = typeof raw.plannedEnd === 'string' ? raw.plannedEnd : '';
      const parsed = candidate === '' ? null : toUtcInstant(candidate);
      if (parsed == null) errors.plannedEnd = ['Planned end must be a valid date-time'];
      else plannedEnd = parsed;
    }

    // Evaluated over the *effective* pair, so a partial reschedule that inverts the window is
    // reported as a field error rather than silently stored.
    if (
      errors.plannedStart === undefined &&
      errors.plannedEnd === undefined &&
      Date.parse(plannedEnd) <= Date.parse(plannedStart)
    ) {
      errors.plannedEnd = ['Planned end must be after planned start'];
    }

    const vehicleProvided = has('vehicleId');
    let vehicleId = route.vehicleId;
    if (vehicleProvided) {
      const parsed = parseOptionalId(raw.vehicleId);
      if (parsed.error) errors.vehicleId = [parsed.error];
      else vehicleId = parsed.id;
    }

    const driverProvided = has('driverId');
    let driverId = route.driverId;
    if (driverProvided) {
      const parsed = parseOptionalId(raw.driverId);
      if (parsed.error) errors.driverId = [parsed.error];
      else driverId = parsed.id;
    }

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    // AC-6: assignment/rename/reschedule is Planned-only; the 409 names the required status.
    if (route.status !== 'Planned') {
      return problem409(
        `Cannot modify a route in status '${route.status}'. The route must be 'Planned'.`,
      );
    }

    // O1: a dangling FK → 404, and the row is left untouched (AC-4).
    if (vehicleProvided && vehicleId != null && !vehiclesDb.some((v) => v.id === vehicleId)) {
      return problem(404, 'Resource not found', `Vehicle with id '${vehicleId}' was not found.`);
    }
    if (driverProvided && driverId != null && !driversDb.some((d) => d.id === driverId)) {
      return problem(404, 'Resource not found', `Driver with id '${driverId}' was not found.`);
    }

    // AC-5: re-check the overlaid window + assignment, excluding this route so re-sending the
    // same window/vehicle pair does not self-conflict.
    const conflict = findRouteConflict(
      Date.parse(plannedStart),
      Date.parse(plannedEnd),
      vehicleId,
      driverId,
      route.id,
    );
    if (conflict) return routeConflict(conflict);

    route.name = name;
    route.plannedStart = plannedStart;
    route.plannedEnd = plannedEnd;
    route.vehicleId = vehicleId;
    route.driverId = driverId;
    route.updatedAt = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    return HttpResponse.json(toRouteResponse(route));
  }),

  // ------------------------------------------- Route shipments (LOGI-0010 AC-1..AC-9)

  /**
   * GET /routes/{id}/shipments — AC-8: the standard paged envelope over the route's assigned
   * shipments plus the `capacity` projection, whose capacityKg/vehicleId/remainingCapacityKg are
   * null when the route has no vehicle. Page params are validated the same way as /routes, so an
   * out-of-range page is a field-keyed 400 rather than a silently clamped read. AC-7/BR-6: a Driver
   * token gets 200 only for a route assigned to their own linked driver, 403 otherwise.
   */
  http.get('/api/v1/routes/:id/shipments', ({ request, params }) => {
    const auth = authorize(request, 'read', 'route shipments', routeRoleRules);
    if (!('user' in auth)) return auth;

    // The path id is a contract int64 with minimum 1, so a non-numeric segment is a 400 (AC-5)
    // rather than a lookup that silently misses.
    const routeIdRaw = String(params.id);
    if (!/^\d+$/.test(routeIdRaw) || Number(routeIdRaw) < 1) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
        id: ['The route id must be an integer greater than or equal to 1.'],
      });
    }
    const routeId = Number(routeIdRaw);
    const route = routesDb.find((r) => r.id === routeId);
    if (!route) return problem(404, 'Resource not found', `Route with id '${routeIdRaw}' was not found.`);

    if (auth.user.role === 'Driver' && route.driverId !== linkedDriverId(auth.user.id)) {
      return problem(403, 'Forbidden', 'The Driver role is not permitted to read the shipments of a route assigned to another driver.');
    }

    const url = new URL(request.url);
    const errors: Record<string, string[]> = {};
    const pageRaw = url.searchParams.get('page');
    const page = pageRaw == null ? 1 : Number(pageRaw);
    if (pageRaw != null && (!Number.isInteger(page) || page < 1)) {
      errors.page = ['Page must be an integer greater than or equal to 1.'];
    }
    const pageSizeRaw = url.searchParams.get('pageSize');
    const pageSize = pageSizeRaw == null ? 25 : Number(pageSizeRaw);
    if (pageSizeRaw != null && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      errors.pageSize = ['Page size must be an integer between 1 and 100.'];
    }
    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    const assigned = shipmentsForRoute(routeId);
    const totalCount = assigned.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
    const start = (page - 1) * pageSize;

    return HttpResponse.json({
      items: assigned.slice(start, start + pageSize).map((s) => toShipmentResponse(s)),
      page,
      pageSize,
      totalCount,
      totalPages,
      // The projection covers ALL assigned shipments, not just the current page, so the remaining
      // capacity does not drift as the operator pages through the list.
      capacity: toRouteCapacityView(route, assigned),
    });
  }),

  /**
   * POST /routes/{id}/shipments — AC-1/AC-2/AC-3/AC-4/AC-5/AC-9: assign one shipment to a route,
   * auto-transitioning it Pending -> Assigned and appending exactly one history row.
   *
   * EVERY guard runs before a single field is mutated, so a rejected assign leaves the shipment,
   * its history and the route's derived numbers byte-identical (AC-9 atomicity). The capacity
   * total is re-read from the store immediately before the write rather than trusted from the
   * caller, so two concurrent boundary assigns cannot both win: the second one observes the
   * first's weight and is rejected with 409.
   */
  http.post('/api/v1/routes/:id/shipments', async ({ request, params }) => {
    const auth = authorize(request, 'write', 'route shipments', routeRoleRules);
    if (!('user' in auth)) return auth;

    const routeIdRaw = String(params.id);
    if (!/^\d+$/.test(routeIdRaw) || Number(routeIdRaw) < 1) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', {
        id: ['The route id must be an integer greater than or equal to 1.'],
      });
    }
    const routeId = Number(routeIdRaw);

    // Parsed defensively: an absent/empty body must still produce a field-keyed 400 on shipmentId
    // (AC-5) rather than a 500 from `request.json()`.
    let raw: Record<string, unknown> = {};
    try {
      raw = (await request.json()) as Record<string, unknown>;
    } catch {
      raw = {};
    }
    const errors: Record<string, string[]> = {};
    const shipmentId = raw.shipmentId;
    if (typeof shipmentId !== 'number' || !Number.isInteger(shipmentId) || shipmentId < 1) {
      errors.shipmentId = ['ShipmentId must be an integer greater than or equal to 1.'];
    }

    const route = routesDb.find((r) => r.id === routeId);
    if (!route) {
      return problem(404, 'Resource not found', `Route with id '${routeIdRaw}' was not found.`);
    }

    let shipment: MockShipment | undefined;
    if (Object.keys(errors).length === 0) {
      shipment = shipmentsDb.find((s) => s.id === shipmentId);
      if (!shipment) {
        return problem(404, 'Resource not found', `Shipment with id '${String(shipmentId)}' was not found.`);
      }

      // AC-4: the idempotent no-op is checked FIRST, before the status and capacity guards. A
      // shipment already on this route is a success (200, current read model, no second history
      // row) even though it is no longer "Pending" and its weight is already inside the assigned
      // total — re-checking capacity here would count the shipment against itself.
      if (shipment.routeId === routeId) {
        return HttpResponse.json(toShipmentResponse(shipment));
      }
    }

    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    // AC-3: assignment is Planned-only; the 409 names the required status.
    if (route.status !== 'Planned') {
      return problem409(
        `Cannot assign a shipment to a route in status '${route.status}'. The route must be 'Planned'.`,
      );
    }

    if (shipment!.status !== 'Pending') {
      return problem409(
        `Cannot assign a shipment in status '${shipment!.status}'. The shipment must be 'Pending'.`,
      );
    }

    // AC-4 / spec §7 O3: one route at a time — moving requires an explicit unassign first.
    if (shipment!.routeId != null) {
      return problem409(
        `Shipment ${shipment!.id} is already assigned to route ${shipment!.routeId}. Unassign it first.`,
      );
    }

    // AC-2 / BR-5: the capacity guard. A route with no vehicle has no capacity to check and
    // accepts the assignment; the 409 detail carries all three numbers the operator needs.
    const vehicle =
      route.vehicleId == null ? null : vehiclesDb.find((v) => v.id === route.vehicleId) ?? null;
    if (vehicle != null) {
      const assignedWeightKg = shipmentsForRoute(routeId).reduce((sum, s) => sum + s.weightKg, 0);
      if (assignedWeightKg + shipment!.weightKg > vehicle.capacityKg) {
        return problem409(
          `Assigning shipment ${shipment!.id} would exceed the vehicle capacity: ` +
            `assigned ${assignedWeightKg} kg + adding ${shipment!.weightKg} kg ` +
            `exceeds capacity ${vehicle.capacityKg} kg.`,
        );
      }
    }

    // All guards passed — the single write point, so any rejection above leaves nothing behind.
    const event: ShipmentStatusEvent = {
      id: ++historyCounter,
      fromStatus: 'Pending',
      toStatus: 'Assigned',
      changedByUserId: auth.user.id,
      changedAt: new Date().toISOString(),
      note: null,
    };
    shipment!.routeId = routeId;
    shipment!.status = 'Assigned';
    shipment!.updatedAt = new Date().toISOString();
    shipment!.statusHistory.push(event);

    return HttpResponse.json(toShipmentResponse(shipment!));
  }),
  /**
   * DELETE /routes/{id}/shipments/{shipmentId} — AC-6: unassign. The shipment returns to
   * `Pending` with a null routeId and gains exactly one Assigned -> Pending history row, which
   * frees its weight for the BR-5 check again. BR-7 has no Assigned -> Pending edge, so this is
   * a first-class endpoint rather than a call to the generic transitions handler.
   *
   * 404 when the route is unknown, the shipment is unknown, or the shipment is simply not on this
   * route (a repeat unassign is therefore a 404, not an idempotent 204). 409 once the shipment has
   * left "Assigned" by another path (InTransit / Delivered / Cancelled).
   */
  http.delete('/api/v1/routes/:id/shipments/:shipmentId', ({ request, params }) => {
    const auth = authorize(request, 'write', 'route shipments', routeRoleRules);
    if (!('user' in auth)) return auth;

    const routeIdRaw = String(params.id);
    const shipmentIdRaw = String(params.shipmentId);
    const errors: Record<string, string[]> = {};
    if (!/^\d+$/.test(routeIdRaw) || Number(routeIdRaw) < 1) {
      errors.id = ['The route id must be an integer greater than or equal to 1.'];
    }
    if (!/^\d+$/.test(shipmentIdRaw) || Number(shipmentIdRaw) < 1) {
      errors.shipmentId = ['The shipment id must be an integer greater than or equal to 1.'];
    }
    if (Object.keys(errors).length > 0) {
      return problem(400, 'Validation failed', 'One or more validation errors occurred.', errors);
    }

    const routeId = Number(routeIdRaw);
    const shipmentId = Number(shipmentIdRaw);
    const route = routesDb.find((r) => r.id === routeId);
    if (!route) {
      return problem(404, 'Resource not found', `Route with id '${routeIdRaw}' was not found.`);
    }
    const shipment = shipmentsDb.find((s) => s.id === shipmentId);
    if (!shipment) {
      return problem(404, 'Resource not found', `Shipment with id '${shipmentIdRaw}' was not found.`);
    }
    // "On another route" and "already unassigned" are the same answer from this route's point of
    // view: the shipment is not on it.
    if (shipment.routeId !== routeId) {
      return problem(404, 'Resource not found', `Shipment ${shipmentId} is not assigned to route ${routeId}.`);
    }
    if (shipment.status !== 'Assigned') {
      return problem409(
        `Cannot unassign a shipment in status '${shipment.status}'. The shipment must be 'Assigned'.`,
      );
    }

    const event: ShipmentStatusEvent = {
      id: ++historyCounter,
      fromStatus: 'Assigned',
      toStatus: 'Pending',
      changedByUserId: auth.user.id,
      changedAt: new Date().toISOString(),
      note: null,
    };
    shipment.routeId = null;
    shipment.status = 'Pending';
    shipment.updatedAt = new Date().toISOString();
    shipment.statusHistory.push(event);

    return new HttpResponse(null, { status: 204 });
  }),
];