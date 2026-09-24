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
});
