import { http, HttpResponse } from 'msw';
import type { AuthUser, ProblemDetails, Role, Vehicle, VehicleInput, Warehouse, WarehouseInput } from '../api/client';

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

export function resetWarehousesDb(seed: Warehouse[] = []): void {
  warehousesDb.splice(0, warehousesDb.length, ...seed);
}

/** Clears the vehicle store and re-seeds the shared id counter when both stores are empty. */
export function resetVehiclesDb(seed: Vehicle[] = []): void {
  vehiclesDb.splice(0, vehiclesDb.length, ...seed);
  if (warehousesDb.length === 0 && seed.length === 0) nextId = 1;
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
): HttpResponse<ProblemDetails> | { user: AuthUser } {
  const user = bearerUser(request);
  if (user === null) {
    return problem(401, 'Unauthorized', 'A valid bearer token is required to access this resource.');
  }
  if (!roleRules[user.role][operation]) {
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
];