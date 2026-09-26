import { expect, test } from '@playwright/test';
import { signIn } from './support/api';
import { getHistory, getShipment } from './support/shipments';
import { patchShipment, postTransition, seedShipmentAt } from './support/shipments';

// LOGI-0008 M1b: guards + cancel + non-regression AC-2 AC-7..AC-10 AC-12.
test.describe('LOGI-0008 edit guards cancel API', () => {
  test('AC-2 PATCH outside Pending is 409 // LOGI-0008 AC-2', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    for (const status of ['Assigned', 'InTransit', 'Delayed', 'Delivered', 'Cancelled'] as const) {
      const seeded = await seedShipmentAt(request, admin, { status });
      const before = await getShipment(request, admin, seeded.id);
      const res = await patchShipment(request, admin, seeded.id, { destinationAddress: 'Nope Rd' });
      expect(res.status).toBe(409);
      expect(String(res.body.detail)).toContain('Pending');
      expect((await getShipment(request, admin, seeded.id)).body?.destinationAddress).toBe(before.body?.destinationAddress);
      expect((await getHistory(request, admin, seeded.id)).body.totalCount).toBe(0);
    }
  });
  test('AC-7 authz matrix // LOGI-0008 AC-7', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const seeded = await seedShipmentAt(request, admin, {});
    expect((await getShipment(request, null, seeded.id)).status).toBe(401);
    expect((await patchShipment(request, null, seeded.id, { weightKg: 9 })).status).toBe(401);
    const viewer = (await signIn(request, 'Viewer')).accessToken;
    expect((await getShipment(request, viewer, seeded.id)).status).toBe(200);
    expect((await patchShipment(request, viewer, seeded.id, { weightKg: 9 })).status).toBe(403);
    const driver = (await signIn(request, 'Driver')).accessToken;
    expect((await getShipment(request, driver, seeded.id)).status).toBe(403);
    expect((await patchShipment(request, driver, seeded.id, { weightKg: 9 })).status).toBe(403);
    expect((await patchShipment(request, admin, seeded.id, { weightKg: 1500 })).status).toBe(200);
  });
  test('AC-8 cancel happy path AC-9 rejects // LOGI-0008 AC-8', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    for (const from of ['Pending', 'Assigned'] as const) {
      const seeded = await seedShipmentAt(request, admin, { status: from });
      const res = await postTransition(request, disp, seeded.id, 'Cancelled', 'Customer withdrew the order');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ fromStatus: from, toStatus: 'Cancelled' });
      expect((await getShipment(request, disp, seeded.id)).body?.status).toBe('Cancelled');
      expect((await getHistory(request, disp, seeded.id)).body.items?.at(-1)).toMatchObject({ toStatus: 'Cancelled' });
    }
    for (const status of ['InTransit', 'Delayed', 'Delivered', 'Cancelled'] as const) {
      const seeded = await seedShipmentAt(request, admin, { status });
      expect((await postTransition(request, admin, seeded.id, 'Cancelled')).status).toBe(409);
    }
  });
  test('AC-10 Driver cannot cancel keeps others // LOGI-0008 AC-10', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const driver = (await signIn(request, 'Driver')).accessToken;
    const viewer = (await signIn(request, 'Viewer')).accessToken;
    const pending = await seedShipmentAt(request, admin, {});
    expect((await postTransition(request, driver, pending.id, 'Cancelled')).status).toBe(403);
    expect((await getHistory(request, admin, pending.id)).body.totalCount).toBe(0);
    expect((await postTransition(request, viewer, pending.id, 'Cancelled')).status).toBe(403);
    expect((await postTransition(request, null, pending.id, 'Cancelled')).status).toBe(401);
    expect((await postTransition(request, driver, pending.id, 'Assigned')).status).toBe(200);
  });
  test('AC-12 slaDueAt stable atRisk false // LOGI-0008 AC-12', async ({ request }) => {
    const admin = (await signIn(request, 'Admin')).accessToken;
    const disp = (await signIn(request, 'Dispatcher')).accessToken;
    const seeded = await seedShipmentAt(request, admin, {});
    const beforeRaw = (await getShipment(request, disp, seeded.id)).body?.slaDueAt;
    const before = beforeRaw == null ? null : String(beforeRaw);
    const ok = await patchShipment(request, disp, seeded.id, { destinationAddress: 'BR-1 Quay' });
    if (ok.status === 200) {
      const afterRaw = (await getShipment(request, disp, seeded.id)).body?.slaDueAt;
      expect(afterRaw == null ? null : String(afterRaw)).toBe(before);
      await postTransition(request, disp, seeded.id, 'Cancelled');
      expect((await getShipment(request, disp, seeded.id)).body?.atRisk).toBe(false);
    } else {
      expect(ok.status).toBe(200);
    }
  });
});
