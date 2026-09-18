import type { components } from './schema';

/**
 * Thin fetch wrapper over the contract-typed API (ADR-004: openapi-typescript +
 * hand-rolled wrapper — no hand-invented endpoints).
 * All paths are relative so the same code works behind the Vite dev proxy,
 * against MSW mocks, and in production.
 */

export type Warehouse = components['schemas']['WarehouseResponse'];
export type WarehouseInput = components['schemas']['WarehouseRequest'];
export type ProblemDetails = components['schemas']['ProblemDetails'];
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });

  if (!response.ok) {
    let problem: Partial<ProblemDetails> = { title: response.statusText };
    try {
      problem = (await response.json()) as Partial<ProblemDetails>;
    } catch {
      // Non-JSON error body — keep the generic problem.
    }
    throw new ApiError(response.status, problem);
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
};
