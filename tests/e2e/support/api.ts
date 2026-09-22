import { expect, type APIRequestContext } from '@playwright/test';
import type { AuthUser, DriverInput, ProblemDetails, Role, TokenResponse, Vehicle, VehicleInput, Warehouse, WarehouseInput } from '../../../src/frontend/src/api/client';

/**
 * Shared E2E helpers for authentication (LOGI-0003).
 *
 * Every domain endpoint now requires a bearer token, so specs and the global reset must sign in
 * first. These helpers always authenticate against the real /auth/login endpoint rather than minting
 * tokens, so the E2E suite exercises the same code path a browser does.
 */

export const API = 'http://localhost:5199';

/** Seeded development accounts, mirroring SeedData.Users / SeedData.DevelopmentPassword. */
export const SEED_PASSWORD = 'logiflow-dev-password';
export const SEED_USERS = {
  Admin: 'alex@logiflow.dev',
  Dispatcher: 'dana@logiflow.dev',
  Driver: 'raj@logiflow.dev',
  Viewer: 'vera@logiflow.dev',
} as const;

export type SeedRole = keyof typeof SEED_USERS;

/** Signs in through the API and returns the token pair plus the user identity. Throws if the account is unusable. */
export async function signIn(
  request: APIRequestContext,
  role: SeedRole = 'Admin',
): Promise<TokenResponse> {
  const response = await request.post(`${API}/api/v1/auth/login`, {
    data: { email: SEED_USERS[role], password: SEED_PASSWORD },
  });
  expect(response.status(), `sign-in as ${role} must succeed`).toBe(200);
  return (await response.json()) as TokenResponse;
}

/** Authorization header for an authenticated API call. */
export function authHeaders(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

/** Seeds a warehouse directly through the API (fast path, not UI). Returns its id. */
export async function seedWarehouse(
  request: APIRequestContext,
  accessToken: string,
  name: string,
  address = '1 Seeded Rd',
): Promise<number> {
  const response = await request.post(`${API}/api/v1/warehouses`, {
    headers: authHeaders(accessToken),
    data: { name, address, latitude: 51.92, longitude: 4.47 },
  });
  expect(response.status(), `seeding '${name}' must succeed`).toBe(201);
  const body = (await response.json()) as { id: number };
  return body.id;
}

/** Seeds a driver directly through the API (fast path, not UI). Returns its id. */
export async function seedDriver(
  request: APIRequestContext,
  accessToken: string,
  fullName: string,
  licenseNumber: string,
  overrides: Partial<DriverInput> = {},
): Promise<number> {
  const response = await request.post(`${API}/api/v1/drivers`, {
    headers: authHeaders(accessToken),
    data: { fullName, licenseNumber, phone: '+31 6 1234 5678', ...overrides },
  });
  expect(response.status(), `seeding '${fullName}' must succeed`).toBe(201);
  const body = (await response.json()) as { id: number };
  return body.id;
}
export async function seedVehicle(
  request: APIRequestContext,
  accessToken: string,
  plateNumber: string,
  overrides: Partial<VehicleInput> = {},
): Promise<number> {
  const response = await request.post(`${API}/api/v1/vehicles`, {
    headers: authHeaders(accessToken),
    data: { plateNumber, type: 'Truck', capacityKg: 12000, ...overrides },
  });
  expect(response.status(), `seeding '${plateNumber}' must succeed`).toBe(201);
  const body = (await response.json()) as { id: number };
  return body.id;
}
