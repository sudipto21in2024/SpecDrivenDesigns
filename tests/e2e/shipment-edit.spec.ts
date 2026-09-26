import { expect, test } from '@playwright/test';
import { seedWarehouse, signIn } from './support/api';
import { createShipment, getHistory, getShipment } from './support/shipments';
import { listShipments, patchShipment } from './support/shipments';

// LOGI-0008 M1a: edit/detail API AC-1..AC-6 on real API + SQLite.
const runTag = `e2e${Date.now().toString(36)}a`;
let seq = 0;
test.describe('LOGI-0008 edit detail API', () => {
  test('AC-1 edit Pending persists subset // LOGI-0008 AC-1', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const wh = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const other = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const created = await createShipment(request, disp, { originWarehouseId: wh, destinationAddress: '12 Dock Road', weightKg: 1250.5 });
    expect(created.status).toBe(201);
    const id = Number(created.body.id);
    const patched = await patchShipment(request, disp, id, { destinationAddress: '99 New Quay', weightKg: 2000, originWarehouseId: other });
    expect(patched.status).toBe(200);
    expect(patched.body.slaDueAt).toBe(created.body.slaDueAt);
    expect((await getShipment(request, disp, id)).body?.destinationAddress).toBe('99 New Quay');
    expect((await getHistory(request, disp, id)).body.totalCount).toBe(1);
    const list = await listShipments(request, disp, { originWarehouseId: other });
    expect(list.body.items?.some((s) => s.id === id)).toBe(true);
  });
  test('AC-3 validation 400s field-keyed // LOGI-0008 AC-3', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const wh = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const created = await createShipment(request, disp, { originWarehouseId: wh, destinationAddress: '12 Dock Road', weightKg: 10 });
    const id = Number(created.body.id);
    const cases: Array<{ body: Record<string, unknown>; key: string }> = [
      { body: { destinationAddress: '   ' }, key: 'destinationAddress' },
      { body: { weightKg: 0 }, key: 'weightKg' },
      { body: { destinationLat: 91 }, key: 'destinationLat' },
      { body: { originWarehouseId: 999999 }, key: 'originWarehouseId' },
      { body: {}, key: 'body' },
    ];
    for (const c of cases) {
      const res = await patchShipment(request, disp, id, c.body);
      expect(res.status, JSON.stringify(c.body)).toBe(400);
      expect((res.body.errors as Record<string, unknown> | undefined)?.[c.key], c.key).toBeDefined();
    }
  });
  test('AC-4 server-owned and priority 400 // LOGI-0008 AC-4', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const wh = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const created = await createShipment(request, disp, { originWarehouseId: wh, destinationAddress: '12 Dock Road', weightKg: 10 });
    const id = Number(created.body.id);
    for (const field of ['referenceCode', 'status', 'slaDueAt', 'priority']) {
      // Paired with a legit field: proves the request is all-or-nothing AND the rejected key is named.
      const res = await patchShipment(request, disp, id, { destinationAddress: 'Legit change', [field]: field === 'priority' ? 'Express' : 'x' });
      expect(res.status, field).toBe(400);
      const keys = Object.keys((res.body.errors as Record<string, unknown> | undefined) ?? {});
      expect(keys.some((k) => k.toLowerCase() === field.toLowerCase()), `${field} in ${keys}`).toBe(true);
    }
  });
  test('AC-5 unknown id 404 AC-6 detail shape // LOGI-0008 AC-5', async ({ request }) => {
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    expect((await patchShipment(request, disp, 999999, { weightKg: 5 })).status).toBe(404);
    expect((await getShipment(request, disp, 999999)).status).toBe(404);
  });
  test('AC-6 detail mirrors list reflects edits // LOGI-0008 AC-6', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const wh = await seedWarehouse(request, admin, `${runTag} WH ${seq++}`);
    const created = await createShipment(request, disp, { originWarehouseId: wh, destinationAddress: '12 Dock Road', weightKg: 10 });
    const id = Number(created.body.id);
    const detail = await getShipment(request, disp, id);
    expect(detail.status).toBe(200);
    expect(detail.body.referenceCode).toMatch(/^SHP-[0-9]{6}$/);
    await patchShipment(request, disp, id, { destinationAddress: 'Edited Quay 1' });
    expect((await getShipment(request, disp, id)).body?.destinationAddress).toBe('Edited Quay 1');
  });
});
