import { expect, test } from '@playwright/test';
import { signIn } from './support/api';
import { driveShipment, getHistory, postTransition, seedShipment } from './support/shipments';

/**
 * LOGI-0006 Shipment status lifecycle — AC-1..AC-8 against the real API + real SQLite (no MSW, no
 * mocks). Every case drives the endpoints with a real JWT from /auth/login and the shipments are
 * seeded into the throwaway database (creation is LOGI-0007 — spec §3 precondition).
 *
 * There is no `GET /shipments/{id}` until LOGI-0007/0008, so "the status is now X" is asserted the
 * way the backend integration suite does: the next legal step from X succeeds, and a jump that is
 * only illegal from X is refused with 409 naming X's legal next states.
 */
test.describe('LOGI-0006 Shipment status lifecycle', () => {
  let adminToken: string;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
  });

  // AC-1 — the forward chain advances one step at a time and every step is audited (spec §4 AC-1).
  test('AC-1 — Pending → Assigned → InTransit → Delivered, one step at a time, each audited', async ({ request }) => {
    const id = await seedShipment(request, adminToken, 'Pending');

    // The first step: 200 with the event echo (fromStatus, toStatus, changedByUserId, note null).
    const first = await postTransition(request, adminToken, id, 'Assigned');
    expect(first.status).toBe(200);
    expect(first.body.fromStatus).toBe('Pending');
    expect(first.body.toStatus).toBe('Assigned');
    expect(first.body.changedByUserId).toBeGreaterThan(0);
    expect(first.body.changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(first.body.note ?? null).toBeNull();

    // The history shows that transition as the newest entry.
    const afterFirst = await getHistory(request, adminToken, id);
    expect(afterFirst.status).toBe(200);
    expect(afterFirst.body.totalCount).toBe(1);
    expect(afterFirst.body.items?.at(-1)).toMatchObject({ fromStatus: 'Pending', toStatus: 'Assigned' });

    // "The shipment's status is now Assigned": a jump that is illegal from Assigned but legal from
    // Pending is refused, so the persisted state really advanced.
    const jump = await postTransition(request, adminToken, id, 'Delivered');
    expect(jump.status).toBe(409);
    expect(jump.body.detail).toContain('Assigned');

    // The rest of the chain, one transition at a time — each step 200, each recorded.
    const events = await driveShipment(request, adminToken, id, 'InTransit', 'Delivered');
    expect(events.map((event) => event.fromStatus)).toEqual(['Assigned', 'InTransit']);
    expect(events.map((event) => event.toStatus)).toEqual(['InTransit', 'Delivered']);

    const history = await getHistory(request, adminToken, id);
    expect(history.body.totalCount).toBe(3);
    expect(history.body.items?.map((event) => event.toStatus)).toEqual(['Assigned', 'InTransit', 'Delivered']);

    // Delivered is terminal: the chain does not continue.
    const beyond = await postTransition(request, adminToken, id, 'Cancelled');
    expect(beyond.status).toBe(409);
  });
});
