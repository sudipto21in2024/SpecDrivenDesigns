import { expect, test, type APIRequestContext } from '@playwright/test';
import { ShipmentsPage } from './pages/shipments.page';
import { seedWarehouse, signIn } from './support/api';
import { createShipment, getHistory, listShipments } from './support/shipments';

/**
 * LOGI-0007 F5 — create shipment (AC-1..AC-5, AC-10 POST side, AC-11) against the real API + real
 * SQLite (no MSW, no mocks). Every request carries a real JWT from /auth/login, and every assertion is
 * scoped to a freshly seeded origin warehouse, so a CI retry (`retries: 1`) can never observe a
 * previous attempt's rows.
 */
const runTag = `e2e${Date.now().toString(36)}`;
let sequence = 0;

/** Whole seconds between two server instants — the spec compares at whole-second precision (§8). */
function secondsBetween(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 1000);
}

test.describe('LOGI-0007 create shipment', () => {
  let dispatcherToken: string;
  let dispatcherUserId: number;
  let adminToken: string;

  test.beforeEach(async ({ request }) => {
    const dispatcher = await signIn(request, 'Dispatcher');
    dispatcherToken = dispatcher.accessToken;
    dispatcherUserId = Number(dispatcher.user.id);
    adminToken = (await signIn(request, 'Admin')).accessToken;
  });

  /** A fresh origin warehouse per test — the scope that keeps every count assertion retry-safe. */
  async function freshWarehouse(request: APIRequestContext): Promise<number> {
    return seedWarehouse(request, adminToken, `${runTag} WH ${sequence++}`);
  }

  // AC-1 — happy path: the Dispatcher's POST returns the created shipment plus one initial audit row.
  test('AC-1 — create returns SHP-######/Pending, exactly one audit row, and list visibility', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);

    const created = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '12 Dock Road, Rotterdam',
      destinationLat: 51.9225,
      destinationLng: 4.47917,
      weightKg: 1250.5,
      priority: 'Standard',
    });

    expect(created.status).toBe(201);
    expect(created.body.referenceCode).toMatch(/^SHP-[0-9]{6}$/);
    expect(created.body.status).toBe('Pending');
    expect(created.body.priority).toBe('Standard');
    expect(created.body.weightKg).toBe(1250.5);
    expect(created.body.originWarehouseId).toBe(warehouseId);
    expect(created.body.destinationAddress).toBe('12 Dock Road, Rotterdam');
    expect(created.body.destinationLat).toBe(51.9225);
    expect(created.body.destinationLng).toBe(4.47917);
    expect(created.body.routeId ?? null).toBeNull();
    // Whole-second ISO8601 UTC (§8); updatedAt starts equal to createdAt.
    expect(created.body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);
    expect(created.body.updatedAt).toBe(created.body.createdAt);
    // BR-1: Standard is +48h from the server's own creation instant (AC-2 covers the derivation).
    expect(secondsBetween(String(created.body.createdAt), String(created.body.slaDueAt))).toBe(48 * 3600);

    const id = Number(created.body.id);
    expect(Number.isInteger(id) && id > 0, 'the response carries the server-assigned id').toBe(true);

    const history = await getHistory(request, dispatcherToken, id);
    expect(history.status).toBe(200);
    expect(history.body.totalCount, 'exactly one audit row is written together with the shipment').toBe(1);
    const initial = history.body.items?.[0];
    expect(initial).toMatchObject({ fromStatus: null, toStatus: 'Pending', changedByUserId: dispatcherUserId });
    expect(Date.parse(String(initial?.changedAt)), 'changedAt equals createdAt').toBe(
      Date.parse(String(created.body.createdAt)),
    );

    const list = await listShipments(request, dispatcherToken, { originWarehouseId: warehouseId });
    expect(list.status).toBe(200);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.items?.map((item) => item.referenceCode)).toEqual([created.body.referenceCode]);
    expect(list.body.items?.[0].atRisk, 'a fresh +48h shipment is not at risk (BR-2)').toBe(false);
  });

  // AC-1 (UI) — the same creation through the shipped dialog, against the unmocked API.
  test('AC-1 (UI) — the create dialog writes the shipment and its row appears in the list', async ({ page, request }) => {
    const warehouseName = `${runTag} UI WH`;
    await seedWarehouse(request, adminToken, warehouseName);

    const shipments = new ShipmentsPage(page);
    await shipments.goto('Dispatcher');

    const code = await shipments.createThroughDialog({
      warehouseName,
      destinationAddress: `${runTag} UI destination`,
      weightKg: 42,
    });
    expect(code).toMatch(/^SHP-[0-9]{6}$/);

    await shipments.search(code);
    await expect(shipments.row(code)).toBeVisible();
    await expect(shipments.row(code).getByText('Pending')).toBeVisible();
  });

  // AC-2 — BR-1: the due date comes from the server's creation instant, never from the client.
  test('AC-2 — slaDueAt is createdAt + 48h (Standard) / +12h (Express); client instants are ignored', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);

    const standard = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '1 Standard Way',
      weightKg: 10,
      priority: 'Standard',
    });
    expect(standard.status).toBe(201);
    // Plain UTC duration arithmetic — no business-hours exclusion (BR-1 rule 1.4), whole seconds (§8).
    expect(secondsBetween(String(standard.body.createdAt), String(standard.body.slaDueAt))).toBe(48 * 3600);
    expect(standard.body.slaDueAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/);

    const express = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '1 Express Way',
      weightKg: 10,
      priority: 'Express',
    });
    expect(express.status).toBe(201);
    expect(secondsBetween(String(express.body.createdAt), String(express.body.slaDueAt))).toBe(12 * 3600);

    // BR-1 rule 1.2 — the promise is never client-controlled: server-owned fields are ignored, not trusted.
    const forged = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '1 Forged Way',
      weightKg: 10,
      priority: 'Express',
      createdAt: '2000-01-01T00:00:00Z',
      updatedAt: '2000-01-01T00:00:00Z',
      slaDueAt: '2000-01-01T00:00:00Z',
      status: 'Delivered',
      referenceCode: 'SHP-000001',
      atRisk: true,
    });
    expect(forged.status).toBe(201);
    expect(Date.parse(String(forged.body.createdAt)), 'createdAt is the server instant').toBeGreaterThan(
      Date.now() - 5 * 60_000,
    );
    expect(forged.body.status).toBe('Pending');
    expect(forged.body.slaDueAt, 'the forged past due date must not be stored').not.toBe('2000-01-01T00:00:00Z');
    expect(secondsBetween(String(forged.body.createdAt), String(forged.body.slaDueAt))).toBe(12 * 3600);
    expect(forged.body.atRisk).toBe(false);
  });

  // AC-3 — BR-1 rules 1.3/1.7: priority defaults to Standard; anything else fails loudly.
  test('AC-3 — omitted priority defaults to Standard; unknown or empty priority is 400 and writes nothing', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);

    const omitted = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: '1 Default Priority Rd',
      weightKg: 500,
    });
    expect(omitted.status).toBe(201);
    expect(omitted.body.priority).toBe('Standard');
    expect(secondsBetween(String(omitted.body.createdAt), String(omitted.body.slaDueAt))).toBe(48 * 3600);

    const before = await listShipments(request, dispatcherToken, { originWarehouseId: warehouseId });
    expect(before.body.totalCount).toBe(1);

    for (const priority of ['Overnight', '']) {
      const rejected = await createShipment(request, dispatcherToken, {
        originWarehouseId: warehouseId,
        destinationAddress: '1 Unknown Priority Rd',
        weightKg: 500,
        priority,
      });
      expect(rejected.status, `priority '${priority}' must be rejected`).toBe(400);
      const problem = rejected.body as { errors?: Record<string, string[]> };
      const message = (problem.errors?.priority ?? []).join(' ');
      expect(message, 'the error names the allowed values').toContain('Standard');
      expect(message).toContain('Express');
    }

    // No silent coercion and no half-written shipment.
    const after = await listShipments(request, dispatcherToken, { originWarehouseId: warehouseId });
    expect(after.body.totalCount, 'a rejected create writes no row').toBe(before.body.totalCount);
  });
});
