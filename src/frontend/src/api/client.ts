import type { components } from './schema';
import { tokenStore } from './tokenStore';

/**
 * Thin fetch wrapper over the contract-typed API (ADR-004: openapi-typescript +
 * hand-rolled wrapper — no hand-invented endpoints).
 * All paths are relative so the same code works behind the Vite dev proxy,
 * against MSW mocks, and in production.
 */

export type Warehouse = components['schemas']['WarehouseResponse'];
export type WarehouseInput = components['schemas']['WarehouseRequest'];
export type Vehicle = components['schemas']['VehicleResponse'];
export type VehicleInput = components['schemas']['VehicleRequest'];
export type VehicleStatus = NonNullable<Vehicle['status']>;
export type VehicleType = NonNullable<Vehicle['type']>;
export type ProblemDetails = components['schemas']['ProblemDetails'];
export type AuthUser = components['schemas']['AuthUser'];
export type LoginInput = components['schemas']['LoginRequest'];
export type TokenResponse = components['schemas']['TokenResponse'];

/** Application roles, mirroring the contract's AuthUser.role enum and Domain/Security/Roles.cs. */
export type Role = AuthUser['role'];

export type Paged<T> = {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

/** Error carrying the RFC 7807 problem details returned by the API. */
export class ApiError extends Error {
  readonly status: number;
  readonly problem: Partial<ProblemDetails>;

  constructor(status: number, problem: Partial<ProblemDetails>) {
    super(problem.title ?? `API error ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.problem = problem;
  }

  /** Field → messages map for form-level display (400 responses). */
  get fieldErrors(): Record<string, string[]> {
    return (this.problem.errors as Record<string, string[]> | undefined) ?? {};
  }
}

/** Paths where a 401 means "these credentials are wrong", not "refresh my session". */
const AUTH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/refresh', '/api/v1/auth/logout'];

/**
 * Invoked when a request fails with 401 and the refresh attempt also fails, i.e. the session is
 * genuinely over. AuthContext registers this to clear state and return the user to the login
 * screen, so no feature component needs to know about token lifetimes (LOGI-0003 AC-12).
 */
let onSessionExpired: (() => void) | null = null;

export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

/** In-flight refresh, so parallel 401s trigger exactly one rotation (rotation is single-use). */
let refreshInFlight: Promise<boolean> | null = null;

/**
 * Exchanges the stored refresh token for a new pair. Uses raw fetch rather than `request` so a
 * failing refresh cannot recurse into another refresh attempt.
 */
async function refreshSession(): Promise<boolean> {
  const stored = tokenStore.get();
  if (stored === null) return false;

  try {
    const response = await fetch('/api/v1/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: stored.refreshToken }),
    });

    if (!response.ok) {
      tokenStore.clear();
      return false;
    }

    const tokens = (await response.json()) as TokenResponse;
    tokenStore.set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
    return true;
  } catch {
    // Network failure: keep the stored tokens (the server may simply be unreachable) but report
    // failure so the caller surfaces the signed-out state.
    return false;
  }
}

function ensureRefreshed(): Promise<boolean> {
  refreshInFlight ??= refreshSession().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  const accessToken = tokenStore.accessToken;
  return fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken !== null ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init?.headers,
    },
  });
}

async function toApiError(response: Response): Promise<ApiError> {
  let problem: Partial<ProblemDetails> = { title: response.statusText };
  try {
    problem = (await response.json()) as Partial<ProblemDetails>;
  } catch {
    // Non-JSON error body — keep the generic problem.
  }
  return new ApiError(response.status, problem);
}

async function request<T>(path: string, init?: RequestInit, retryOn401 = true): Promise<T> {
  const response = await send(path, init);

  // AC-12: an expired access token costs one silent refresh + one retry, not a lost session.
  // Auth paths are excluded — their 401 is the endpoint's answer, not a staleness signal.
  if (response.status === 401 && retryOn401 && !AUTH_PATHS.some((p) => path.startsWith(p))) {
    if (await ensureRefreshed()) {
      return request<T>(path, init, false);
    }
    onSessionExpired?.();
  }

  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export const api = {
  listWarehouses(page = 1, pageSize = 25, q?: string): Promise<Paged<Warehouse>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) params.set('q', q);
    return request<Paged<Warehouse>>(`/api/v1/warehouses?${params.toString()}`);
  },
  getWarehouse(id: number): Promise<Warehouse> {
    return request<Warehouse>(`/api/v1/warehouses/${id}`);
  },
  createWarehouse(body: WarehouseInput): Promise<Warehouse> {
    return request<Warehouse>('/api/v1/warehouses', { method: 'POST', body: JSON.stringify(body) });
  },
  updateWarehouse(id: number, body: WarehouseInput): Promise<Warehouse> {
    return request<Warehouse>(`/api/v1/warehouses/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  },
  deleteWarehouse(id: number): Promise<void> {
    return request<void>(`/api/v1/warehouses/${id}`, { method: 'DELETE' });
  },
  listVehicles(
    page = 1,
    pageSize = 25,
    q?: string,
    status?: string,
    type?: string,
  ): Promise<Paged<Vehicle>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    if (type) params.set('type', type);
    return request<Paged<Vehicle>>(`/api/v1/vehicles?${params.toString()}`);
  },
  getVehicle(id: number): Promise<Vehicle> {
    return request<Vehicle>(`/api/v1/vehicles/${id}`);
  },
  createVehicle(body: VehicleInput): Promise<Vehicle> {
    return request<Vehicle>('/api/v1/vehicles', { method: 'POST', body: JSON.stringify(body) });
  },
  updateVehicle(id: number, body: VehicleInput): Promise<Vehicle> {
    return request<Vehicle>(`/api/v1/vehicles/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  },
  deleteVehicle(id: number): Promise<void> {
    return request<void>(`/api/v1/vehicles/${id}`, { method: 'DELETE' });
  },

  /** AC-1/AC-2: exchange credentials for a token pair. */
  login(body: LoginInput): Promise<TokenResponse> {
    return request<TokenResponse>('/api/v1/auth/login', { method: 'POST', body: JSON.stringify(body) });
  },

  /** AC-8: identity carried by the access token (used to restore a session on start-up). */
  me(): Promise<AuthUser> {
    return request<AuthUser>('/api/v1/auth/me');
  },

  /** AC-9: revoke the refresh token server-side so it can never be exchanged again. */
  logout(refreshToken: string): Promise<void> {
    return request<void>('/api/v1/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },
};
