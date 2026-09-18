import { http, HttpResponse } from 'msw';
import type { ProblemDetails, Warehouse, WarehouseInput } from '../api/client';

/**
 * MSW handlers derived from contracts/v1-openapi.yaml (ADR-004). The in-memory
 * store mirrors the API behaviour (pagination envelope, ProblemDetails errors,
 * 201/204/404 semantics) so UI work and unit tests run without the backend.
 */

export const warehousesDb: Warehouse[] = [];
let nextId = 1;

export function resetWarehousesDb(seed: Warehouse[] = []): void {
  warehousesDb.splice(0, warehousesDb.length, ...seed);
}

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

function problem(
  status: number,
  title: string,
  detail: string,
  errors?: Record<string, string[]>,
): HttpResponse<ProblemDetails> {
  return HttpResponse.json(
    {
      type: `https://logiflow.dev/errors/${status === 404 ? 'not-found' : 'validation'}`,
      title,
      status,
      detail,
      errors,
      traceId: 'msw',
    },
    { status },
  );
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

export const handlers = [
  http.get('/api/v1/warehouses', ({ request }) => {
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

  http.get('/api/v1/warehouses/:id', ({ params }) => {
    const warehouse = warehousesDb.find((w) => w.id === Number(params.id));
    return warehouse
      ? HttpResponse.json(warehouse)
      : problem(404, 'Resource not found', `Warehouse with id '${String(params.id)}' was not found.`);
  }),

  http.post('/api/v1/warehouses', async ({ request }) => {
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

  http.delete('/api/v1/warehouses/:id', ({ params }) => {
    const index = warehousesDb.findIndex((w) => w.id === Number(params.id));
    if (index === -1) return problem(404, 'Resource not found', `Warehouse with id '${String(params.id)}' was not found.`);
    warehousesDb.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),
];
