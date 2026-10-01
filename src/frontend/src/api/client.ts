import type { components, operations } from './schema';
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
export type Driver = components['schemas']['DriverResponse'];
export type DriverInput = components['schemas']['DriverRequest'];
export type DriverStatus = NonNullable<Driver['status']>;
export type UserId = NonNullable<Driver['userId']>;
export type ShipmentStatusEvent = components['schemas']['ShipmentStatusEvent'];
export type ShipmentStatus = NonNullable<ShipmentStatusEvent['toStatus']>;
export type StatusTransitionRequest = components['schemas']['StatusTransitionRequest'];
/** LOGI-0007 F5/F8: shipment read model + create body (contract-derived aliases). */
export type Shipment = components['schemas']['ShipmentResponse'];
export type ShipmentInput = components['schemas']['ShipmentRequest'];
export type ShipmentPriority = NonNullable<Shipment['priority']>;
/** LOGI-0008 AC-1..AC-4: PATCH /shipments/{id} body — every property optional (send only what changes). */
export type ShipmentUpdateInput = components['schemas']['ShipmentUpdateRequest'];
/** LOGI-0009: Route read model + create/update bodies. */
export type Route = components['schemas']['RouteResponse'];
export type RouteInput = components['schemas']['RouteRequest'];
export type RouteUpdateInput = components['schemas']['RouteUpdateRequest'];
export type RouteStatus = NonNullable<Route['status']>;
export type ListRoutesParams = NonNullable<operations['listRoutes']['parameters']['query']>;
/** LOGI-0010 AC-8: the paged route-shipments envelope + its BR-5 capacity projection. */
export type RouteShipmentsPage = components['schemas']['RouteShipmentsPage'];
/** LOGI-0010 AC-2/AC-8: capacityKg/vehicleId/remainingCapacityKg are null for a vehicle-less route. */
export type RouteCapacityView = components['schemas']['RouteCapacityView'];
/** LOGI-0010 AC-1: the assign body — the only field is the shipment to add. */
export type AssignShipmentToRouteInput = components['schemas']['AssignShipmentToRouteRequest'];
/** Optional paging params for GET /routes/{id}/shipments (contract-derived). */
export type ListRouteShipmentsParams = NonNullable<operations['listRouteShipments']['parameters']['query']>;
/** Sort keys accepted by GET /shipments — createdAt|-createdAt|slaDueAt|-slaDueAt (default -createdAt). */
export type ShipmentSort = NonNullable<
  NonNullable<operations['listShipments']['parameters']['query']>['sort']
>;
/** Optional query params for GET /shipments (every field optional, contract-derived). */
export type ListShipmentsParams = NonNullable<operations['listShipments']['parameters']['query']>;
/** LOGI-0011 AC-1: the whole board in one response — six columns + route cards + applied filters. */
export type PlanningBoardResponse = components['schemas']['PlanningBoardResponse'];
/** LOGI-0011 AC-1: one kanban column; `totalCount` is UNTRUNCATED, `cards` is capped. */
export type BoardColumn = components['schemas']['BoardColumn'];
/** LOGI-0011 AC-1: a read-only shipment card, a SUBSET of Shipment — never a second source. */
export type BoardShipmentCard = components['schemas']['BoardShipmentCard'];
/** LOGI-0011 AC-4: a route card whose `capacity` is the same RouteCapacityView BR-5 enforces. */
export type BoardRouteCard = components['schemas']['BoardRouteCard'];
/** LOGI-0011 AC-3: the echo of the filters the server actually applied; unsupplied ones are null. */
export type BoardFilters = components['schemas']['BoardFilters'];
/** Optional query params for GET /planning-board (contract-derived, eight params). */
export type GetPlanningBoardParams = NonNullable<
  operations['getPlanningBoard']['parameters']['query']
>;
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

  /** AC-1/AC-7: paged driver list with full-name search + status filter. */
  listDrivers(
    page = 1,
    pageSize = 25,
    q?: string,
    status?: string,
  ): Promise<Paged<Driver>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    return request<Paged<Driver>>(`/api/v1/drivers?${params.toString()}`);
  },
  /** AC-8: get driver by id. */
  getDriver(id: number): Promise<Driver> {
    return request<Driver>(`/api/v1/drivers/${id}`);
  },
  /** AC-1: create driver. */
  createDriver(body: DriverInput): Promise<Driver> {
    return request<Driver>('/api/v1/drivers', { method: 'POST', body: JSON.stringify(body) });
  },
  /** AC-6/AC-8: full update driver (PUT null/omitted userId clears the user link). */
  updateDriver(id: number, body: DriverInput): Promise<Driver> {
    return request<Driver>(`/api/v1/drivers/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  },
  /** AC-8: delete driver. */
  deleteDriver(id: number): Promise<void> {
    return request<void>(`/api/v1/drivers/${id}`, { method: 'DELETE' });
  },

  /** LOGI-0006 AC-1: transition a shipment's status (BR-7 legal transitions only — 409 with the legal next states otherwise). */
  transitionShipmentStatus(id: number, body: StatusTransitionRequest): Promise<ShipmentStatusEvent> {
    return request<ShipmentStatusEvent>(`/api/v1/shipments/${id}/status-transitions`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** LOGI-0006 AC-7: paged status audit trail, oldest first. */
  listShipmentStatusHistory(id: number, page = 1, pageSize = 25): Promise<Paged<ShipmentStatusEvent>> {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    return request<Paged<ShipmentStatusEvent>>(`/api/v1/shipments/${id}/status-history?${params.toString()}`);
  },

  /**
   * LOGI-0007 F8 (AC-6..AC-9): paged, filterable shipment list.
   * Only supplied filters are serialized so omitted params keep their contract defaults.
   */
  listShipments(params: ListShipmentsParams = {}): Promise<Paged<Shipment>> {
    const query = new URLSearchParams();
    if (params.page != null) query.set('page', String(params.page));
    if (params.pageSize != null) query.set('pageSize', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    if (params.priority) query.set('priority', params.priority);
    if (params.originWarehouseId != null) query.set('originWarehouseId', String(params.originWarehouseId));
    if (params.slaRisk != null) query.set('slaRisk', String(params.slaRisk));
    if (params.q) query.set('q', params.q);
    if (params.sort) query.set('sort', params.sort);
    return request<Paged<Shipment>>(`/api/v1/shipments?${query.toString()}`);
  },

  /** LOGI-0007 F5 (AC-1): create shipment — the 201 body is the authoritative read-back. */
  /** LOGI-0009: paged, filterable route list. */
  listRoutes(params: ListRoutesParams = {}): Promise<Paged<Route>> {
    const query = new URLSearchParams();
    if (params.page != null) query.set('page', String(params.page));
    if (params.pageSize != null) query.set('pageSize', String(params.pageSize));
    if (params.status) query.set('status', params.status);
    if (params.vehicleId != null) query.set('vehicleId', String(params.vehicleId));
    if (params.driverId != null) query.set('driverId', String(params.driverId));
    if (params.q) query.set('q', params.q);
    return request<Paged<Route>>('/api/v1/routes?' + query.toString());
  },

  /** LOGI-0009: route detail. */
  getRoute(id: number): Promise<Route> {
    return request<Route>('/api/v1/routes/' + id);
  },

  /** LOGI-0009: create route. */
  createRoute(body: RouteInput): Promise<Route> {
    return request<Route>('/api/v1/routes', { method: 'POST', body: JSON.stringify(body) });
  },

  /** LOGI-0009: partial update / assignment of a Planned route. */
  updateRoute(id: number, body: RouteUpdateInput): Promise<Route> {
    return request<Route>('/api/v1/routes/' + id, { method: 'PATCH', body: JSON.stringify(body) });
  },

  /** LOGI-0010 AC-8: paged assigned shipments plus the BR-5 capacity projection. */
  listRouteShipments(
    routeId: number,
    params: ListRouteShipmentsParams = {},
  ): Promise<RouteShipmentsPage> {
    const query = new URLSearchParams();
    if (params.page != null) query.set('page', String(params.page));
    if (params.pageSize != null) query.set('pageSize', String(params.pageSize));
    return request<RouteShipmentsPage>(`/api/v1/routes/${routeId}/shipments?${query.toString()}`);
  },

  /**
   * LOGI-0010 AC-1: assign a shipment to a route. The 200 body is the authoritative read-back —
   * it carries `routeId` and status "Assigned" — so the caller can show the new state without a
   * second read. Every guard is a ProblemDetails failure (404/409/400) surfaced as `ApiError`.
   */
  assignShipmentToRoute(routeId: number, body: AssignShipmentToRouteInput): Promise<Shipment> {
    return request<Shipment>(`/api/v1/routes/${routeId}/shipments`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /** LOGI-0010 AC-6: unassign — 204 with an empty body, so there is nothing to return. */
  removeShipmentFromRoute(routeId: number, shipmentId: number): Promise<void> {
    return request<void>(`/api/v1/routes/${routeId}/shipments/${shipmentId}`, { method: 'DELETE' });
  },

  /**
   * LOGI-0011 AC-1/AC-3/AC-8: the whole planning board in ONE read — six status columns, the route
   * cards with their BR-5 capacity, the echo of the applied filters and the unassigned count.
   *
   * Read-only by design (spec §7 O3): the board is the only surface it calls, because a drag would
   * be a second BR-7 entry point and a drop-on-route a second BR-5 one. Every filter is a query
   * param — never a client-side filter over an unpaged list (spec §5).
   *
   * Absent params are omitted rather than sent empty, so the server's own defaults apply; the
   * response's `appliedFilters` is then the authority for what was actually applied (AC-3).
   */
  getPlanningBoard(params: GetPlanningBoardParams = {}): Promise<PlanningBoardResponse> {
    const query = new URLSearchParams();
    if (params.status) query.set('status', params.status);
    if (params.priority) query.set('priority', params.priority);
    if (params.originWarehouseId != null) query.set('originWarehouseId', String(params.originWarehouseId));
    if (params.slaRisk != null) query.set('slaRisk', String(params.slaRisk));
    if (params.routeId != null) query.set('routeId', String(params.routeId));
    if (params.q) query.set('q', params.q);
    if (params.sort) query.set('sort', params.sort);
    if (params.maxPerColumn != null) query.set('maxPerColumn', String(params.maxPerColumn));
    return request<PlanningBoardResponse>(`/api/v1/planning-board?${query.toString()}`);
  },

  createShipment(body: ShipmentInput): Promise<Shipment> {
    return request<Shipment>('/api/v1/shipments', { method: 'POST', body: JSON.stringify(body) });
  },

  /** LOGI-0008 AC-6: shipment detail — the read the edit dialog pre-fills from. */
  getShipment(id: number): Promise<Shipment> {
    return request<Shipment>(`/api/v1/shipments/${id}`);
  },

  /**
   * LOGI-0008 AC-1..AC-5: partial update of a Pending shipment. Only the supplied keys are sent
   * (server-owned/immutable fields are rejected with 400 and a non-Pending shipment with 409), so
   * the caller must build the body from what actually changed.
   */
  updateShipment(id: number, body: ShipmentUpdateInput): Promise<Shipment> {
    return request<Shipment>(`/api/v1/shipments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
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
