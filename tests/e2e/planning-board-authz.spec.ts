import { expect, test } from '@playwright/test';
import { API, seedWarehouse, signIn } from './support/api';
import { seedRoute, uniqueRef } from './support/routes';
import { driverScopedWindow } from './support/route-shipments';
import { getPlanningBoard, sendBoardVerb } from './support/planning-board';
import { getShipment } from './support/shipments';

/**
 * LOGI-0011 authorization and read-only-ness against the real API with real JWTs (AC-6, AC-7).
 *
 * The role matrix is asserted on the API, never on a hidden UI affordance: the Board tab is hidden
 * for a Driver in the UI, but that is hygiene, and a test proving it would pass even if the
 * endpoint were wide open. §7 O1 is the decision under test here — Viewer keeps read access on every
 * v1 read surface, while Driver is refused the org-wide board because BR-6 scopes a Driver to their
 * own route.
 */
test.describe('LOGI-0011 planning board authorization (API)', () => {
  let adminToken: string;
  let dispatcherToken: string;
  let viewerToken: string;
  let driverToken: string;
  let warehouseId: number;
  let routeId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
    viewerToken = (await signIn(request, 'Viewer')).accessToken;
    driverToken = (await signIn(request, 'Driver')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('PBZ')}`);
    routeId = (await seedRoute({
      status: 'Planned',
      plannedStart: driverScopedWindow(2_000_000),
      plannedEnd: driverScopedWindow(2_000_480),
    })).id;
  });

  // LOGI-0011 AC-6
  test('AC-6 — anonymous is 401 with a bearer challenge // LOGI-0011 AC-6', async ({ request }) => {
    expect((await getPlanningBoard(request, null)).status).toBe(401);

    const challenged = await request.get(`${API}/api/v1/planning-board`);
    expect(challenged.status()).toBe(401);
    expect(challenged.headers()['www-authenticate']).toContain('Bearer');
  });

  // LOGI-0011 AC-6
  test('AC-6 — a Viewer reads with the same body an Admin reads // LOGI-0011 AC-6', async ({ request }) => {
    const asAdmin = await getPlanningBoard(request, adminToken, { routeId });
    const asViewer = await getPlanningBoard(request, viewerToken, { routeId });

    expect(asAdmin.status).toBe(200);
    expect(asViewer.status).toBe(200);
    // Byte-for-byte identical: read access is not a reduced projection for a Viewer.
    expect(asViewer.body.columns).toEqual(asAdmin.body.columns);
    expect(asViewer.body.routes).toEqual(asAdmin.body.routes);
    expect(asViewer.body.unassignedTotalCount).toBe(asAdmin.body.unassignedTotalCount);
    // Dispatcher — the board's own persona — reads it too.
    expect((await getPlanningBoard(request, dispatcherToken, { routeId })).status).toBe(200);
  });

  // LOGI-0011 AC-6
  test('AC-6 — a Driver is refused the org-wide board with ProblemDetails // LOGI-0011 AC-6', async ({
    request,
  }) => {
    const refused = await getPlanningBoard(request, driverToken);

    // §7 O1: the board is org-wide, so BR-6 own-route scoping cannot be expressed as a filter here.
    expect(refused.status).toBe(403);
    expect(refused.body.title).toBeTruthy();
    expect(refused.body.status).toBe(403);
  });

  // LOGI-0011 AC-7
  test('AC-7 — the board is read-only: every write verb is 405 on both paths // LOGI-0011 AC-7', async ({
    request,
  }) => {
    const collection = '/api/v1/planning-board';
    // §7 O3 is proved on the path the API actually maps. `/planning-board/{id}` is deliberately NOT
    // in the routing table at all — see the finding recorded for this arm — so it is asserted
    // separately as "unmapped", which is a stronger no-write guarantee than a 405.
    const item = '/api/v1/planning-board/1';

    // Asserted for the role that *would* be allowed to write if the surface existed (Dispatcher),
    // so the 405 is "this endpoint has no write", not "this role may not write".
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      const attempt = await sendBoardVerb(request, dispatcherToken, verb, collection);
      expect(attempt.status, `${verb.toUpperCase()} ${collection} -> ${attempt.body}`).toBe(405);
      expect(attempt.allow, `${verb.toUpperCase()} must advertise the allowed verbs`).toContain('GET');
    }

    // The item path has no route at any verb, so no per-shipment write entry point exists.
    for (const verb of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const attempt = await sendBoardVerb(request, dispatcherToken, verb, item);
      expect(attempt.status, `${verb.toUpperCase()} ${item} -> ${attempt.body}`).toBe(404);
    }

    // Even a forbidden role gets 405 rather than leaking that the path exists for someone else.
    expect((await sendBoardVerb(request, driverToken, 'post', collection)).status).toBe(405);

    // And the rejection wrote nothing: the board reads identically before and after the attempts.
    const before = await getPlanningBoard(request, adminToken, { routeId });
    await sendBoardVerb(request, dispatcherToken, 'post', collection);
    const after = await getPlanningBoard(request, adminToken, { routeId });
    expect(after.body.columns).toEqual(before.body.columns);
  });
});
