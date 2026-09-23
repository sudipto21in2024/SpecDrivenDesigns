import { http, HttpResponse } from 'msw';
import type { AuthUser, ProblemDetails, Role, Vehicle, VehicleInput, Warehouse, WarehouseInput, Driver, DriverInput, ShipmentStatusEvent, ShipmentStatus, StatusTransitionRequest, Shipment, ShipmentInput, ShipmentPriority } from '../api/client';

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
];