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

  // AC-2 — Cancelled is legal only from Pending or Assigned, and is terminal (spec §4 AC-2).
  test('AC-2 — Cancelled is legal from Pending and Assigned only, and is terminal', async ({ request }) => {
    const fromPending = await seedShipment(request, adminToken, 'Pending');
    const cancelled = await postTransition(request, adminToken, fromPending, 'Cancelled');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ fromStatus: 'Pending', toStatus: 'Cancelled' });

    // Terminal: nothing leaves Cancelled, and the refused attempt is not recorded.
    const again = await postTransition(request, adminToken, fromPending, 'Assigned');
    expect(again.status).toBe(409);
    expect(again.body.title).toBe('Conflict');
    expect(again.body.status).toBe(409);
    expect(again.body.detail).toContain('Cancelled');
    expect((await getHistory(request, adminToken, fromPending)).body.totalCount).toBe(1);

    const fromAssigned = await seedShipment(request, adminToken, 'Assigned');
    const late = await postTransition(request, adminToken, fromAssigned, 'Cancelled');
    expect(late.status).toBe(200);
    expect(late.body).toMatchObject({ fromStatus: 'Assigned', toStatus: 'Cancelled' });

    // Too late once the shipment is InTransit or Delivered.
    for (const status of ['InTransit', 'Delivered'] as const) {
      const id = await seedShipment(request, adminToken, status);
      const refused = await postTransition(request, adminToken, id, 'Cancelled');
      expect(refused.status, `Cancelled must be refused from ${status}`).toBe(409);
      expect(refused.body.detail).toContain('legal next state(s)');
      expect((await getHistory(request, adminToken, id)).body.totalCount).toBe(0);
    }
  });

  // AC-3 — Delayed is InTransit-scoped and reversible (spec §4 AC-3).
  test('AC-3 — Delayed only from InTransit, reversible back to InTransit', async ({ request }) => {
    const id = await seedShipment(request, adminToken, 'InTransit');
    const delayed = await postTransition(request, adminToken, id, 'Delayed');
    expect(delayed.status).toBe(200);
    expect(delayed.body).toMatchObject({ fromStatus: 'InTransit', toStatus: 'Delayed' });

    const back = await postTransition(request, adminToken, id, 'InTransit');
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ fromStatus: 'Delayed', toStatus: 'InTransit' });

    for (const status of ['Pending', 'Assigned', 'Delivered'] as const) {
      const seeded = await seedShipment(request, adminToken, status);
      const refused = await postTransition(request, adminToken, seeded, 'Delayed');
      expect(refused.status, `Delayed must be refused from ${status}`).toBe(409);
      // The detail names the legal next states of the *current* status (AC-4), not the requested target.
      expect(refused.body.detail).toContain('legal next state(s)');
    }

    // BR-7 checkpoint answer: Delayed → Cancelled is deliberately NOT legal (only InTransit is).
    const stuck = await seedShipment(request, adminToken, 'InTransit');
    await driveShipment(request, adminToken, stuck, 'Delayed');
    const cancelWhileDelayed = await postTransition(request, adminToken, stuck, 'Cancelled');
    expect(cancelWhileDelayed.status).toBe(409);
    expect(cancelWhileDelayed.body.detail).toContain('InTransit');
    expect(
      (await getHistory(request, adminToken, stuck)).body.totalCount,
      'the refused Delayed → Cancelled attempt must not be recorded',
    ).toBe(1);
  });

  // AC-4 — BR-7 is enforced server-side: an illegal jump is 409 naming the legal next states (spec §4 AC-4).
  test('AC-4 — illegal jump is refused with 409 naming the legal next states, and writes no row', async ({ request }) => {
    const id = await seedShipment(request, adminToken, 'Pending');

    for (const jump of ['InTransit', 'Delivered', 'Delayed', 'Pending'] as const) {
      const refused = await postTransition(request, adminToken, id, jump);
      expect(refused.status, `Pending → ${jump} is not a BR-7 transition`).toBe(409);
      expect(refused.body.title).toBe('Conflict');
      expect(refused.body.status).toBe(409);
      expect(refused.body.detail).toContain('legal next state(s)');
      expect(refused.body.detail).toContain('Assigned');
      expect(refused.body.detail).toContain('Cancelled');
    }

    // Status unchanged and nothing recorded — the shipment is still Pending.
    expect((await getHistory(request, adminToken, id)).body.totalCount).toBe(0);
    const legal = await postTransition(request, adminToken, id, 'Assigned');
    expect(legal.status).toBe(200);
    expect(legal.body.fromStatus).toBe('Pending');
  });

  // AC-5 — input validation: toStatus required and known, note capped at 500 characters (spec §4 AC-5).
  test('AC-5 — missing/empty/unknown toStatus and an overlong note are 400 with field errors', async ({ request }) => {
    const id = await seedShipment(request, adminToken, 'Pending');
    const fields = (errors: Record<string, unknown> | null | undefined) => Object.keys(errors ?? {});

    // No body at all (Playwright drops undefined properties, so this sends `{}`).
    const empty = await postTransition(request, adminToken, id, undefined);
    expect(empty.status).toBe(400);
    expect(fields(empty.body.errors)).toContain('toStatus');

    const blank = await postTransition(request, adminToken, id, '');
    expect(blank.status).toBe(400);
    expect(fields(blank.body.errors)).toContain('toStatus');

    const unknown = await postTransition(request, adminToken, id, 'Flying');
    expect(unknown.status).toBe(400);
    expect(fields(unknown.body.errors)).toContain('toStatus');

    const overlong = await postTransition(request, adminToken, id, 'Assigned', 'x'.repeat(501));
    expect(overlong.status).toBe(400);
    expect(fields(overlong.body.errors)).toContain('note');

    const atLimit = await postTransition(request, adminToken, id, 'Assigned', 'x'.repeat(500));
    expect(atLimit.status, '500 characters is the contract limit — it must be accepted').toBe(200);

    // None of the rejected calls were recorded: only the accepted at-limit transition is in the trail.
    const history = await getHistory(request, adminToken, id);
    expect(history.body.totalCount).toBe(1);
    expect(history.body.items?.[0].note).toBe('x'.repeat(500));
  });

  // AC-6 — an unknown shipment is 404 on both endpoints (spec §4 AC-6).
  test('AC-6 — an unknown shipment id returns 404 on both endpoints', async ({ request }) => {
    const unknown = 999_999_999; // no fixture ever seeds this id

    const transition = await postTransition(request, adminToken, unknown, 'Assigned');
    expect(transition.status).toBe(404);
    expect(transition.body.status).toBe(404);
    expect(transition.body.title).toBeTruthy();

    const history = await getHistory(request, adminToken, unknown);
    expect(history.status).toBe(404);
    expect(history.body.status).toBe(404);
    expect(history.body.title).toBeTruthy();
  });

  // AC-7 — the audit trail is append-only, ordered oldest → newest and paged (spec §4 AC-7).
  test('AC-7 — history is append-only, ordered oldest to newest, paged, and never records refusals', async ({ request }) => {
    const id = await seedShipment(request, adminToken, 'Pending');
    await driveShipment(request, adminToken, id, 'Assigned');
    const inTransit = await postTransition(request, adminToken, id, 'InTransit', 'Loaded onto vehicle QA-0001');
    expect(inTransit.status).toBe(200);
    expect(inTransit.body.note).toBe('Loaded onto vehicle QA-0001');
    await driveShipment(request, adminToken, id, 'Delayed');

    // A refused attempt never enters the audit trail.
    const refused = await postTransition(request, adminToken, id, 'Cancelled');
    expect(refused.status).toBe(409);

    const all = await getHistory(request, adminToken, id);
    expect(all.body).toMatchObject({ page: 1, pageSize: 25, totalCount: 3, totalPages: 1 });
    expect(all.body.items?.map((event) => event.toStatus)).toEqual(['Assigned', 'InTransit', 'Delayed']);
    expect(all.body.items?.map((event) => event.fromStatus)).toEqual(['Pending', 'Assigned', 'InTransit']);

    // Append-only: ids ascend and the note is echoed verbatim with its acting user recorded.
    const ids = all.body.items?.map((event) => event.id) ?? [];
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(all.body.items?.every((event) => (event.changedByUserId ?? 0) > 0)).toBe(true);
    expect(all.body.items?.[1].note).toBe('Loaded onto vehicle QA-0001');
    expect(all.body.items?.[0].note ?? null).toBeNull();

    const page1 = await getHistory(request, adminToken, id, '?page=1&pageSize=2');
    expect(page1.body).toMatchObject({ page: 1, pageSize: 2, totalCount: 3, totalPages: 2 });
    expect(page1.body.items?.map((event) => event.toStatus)).toEqual(['Assigned', 'InTransit']);

    const page2 = await getHistory(request, adminToken, id, '?page=2&pageSize=2');
    expect(page2.body).toMatchObject({ page: 2, pageSize: 2, totalCount: 3, totalPages: 2 });
    expect(page2.body.items?.map((event) => event.toStatus)).toEqual(['Delayed']);
  });

  // AC-8 — the role matrix per contract x-roles (spec §4 AC-8, §2).
  test('AC-8 — anonymous 401, Viewer reads but cannot transition, Driver/Dispatcher/Admin may', async ({ request }) => {
    const id = await seedShipment(request, adminToken, 'Pending');

    // Anonymous: no token at all → 401 on both endpoints.
    expect((await postTransition(request, null, id, 'Assigned')).status).toBe(401);
    expect((await getHistory(request, null, id)).status).toBe(401);

    // Viewer: read-only — 403 ProblemDetails on transition, 200 on the history read.
    const viewer = (await signIn(request, 'Viewer')).accessToken;
    const viewerAttempt = await postTransition(request, viewer, id, 'Assigned');
    expect(viewerAttempt.status).toBe(403);
    expect(viewerAttempt.body.title).toBe('Forbidden');
    expect(viewerAttempt.body.status).toBe(403);
    expect((await getHistory(request, viewer, id)).status).toBe(200);
    expect(
      (await getHistory(request, adminToken, id)).body.totalCount,
      'the refused Viewer attempt must not move the shipment or write a row',
    ).toBe(0);

    // Driver: declared in the contract x-roles; own-route scoping lands with LOGI-0009/0010.
    const driver = (await signIn(request, 'Driver')).accessToken;
    expect((await postTransition(request, driver, id, 'Assigned')).status).toBe(200);
    expect((await getHistory(request, driver, id)).status).toBe(200);

    // Dispatcher: 2xx on both; Admin (beforeEach token) closes the chain.
    const dispatcher = (await signIn(request, 'Dispatcher')).accessToken;
    expect((await postTransition(request, dispatcher, id, 'InTransit')).status).toBe(200);
    expect((await getHistory(request, dispatcher, id)).status).toBe(200);
    expect((await postTransition(request, adminToken, id, 'Delivered')).status).toBe(200);

    // Every accepted transition was attributed to the caller that made it.
    const history = await getHistory(request, adminToken, id);
    expect(history.body.totalCount).toBe(3);
    const actors = new Set(history.body.items?.map((event) => event.changedByUserId) ?? []);
    expect(actors.size, 'each accepted transition records its own acting user').toBe(3);
  });
});
