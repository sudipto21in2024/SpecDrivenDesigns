import { expect, test } from '@playwright/test';
import { API, seedWarehouse, signIn } from './support/api';
import { uniqueRef } from './support/routes';
import { getDashboard, sendDashboardVerb } from './support/dashboard';

/**
 * LOGI-0012 authorization and read-only-ness against the real API with real JWTs (AC-7).
 *
 * The role matrix is asserted on the API, never on a hidden UI affordance: the Dashboard tab is hidden
 * for a Driver in the UI, but that is hygiene, and a test proving it would pass even if the endpoint
 * were wide open. Spec §7 O1 is the decision under test — Viewer keeps read access on every v1 read
 * surface, while Driver is refused the org-wide dashboard because BR-6 scopes a Driver to their own
 * route and the counts would then mean "of what you may see" rather than "of the operation".
 */
test.describe('LOGI-0012 operations dashboard authorization (API)', () => {
  let adminToken: string;
  let dispatcherToken: string;
  let viewerToken: string;
  let driverToken: string;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
    viewerToken = (await signIn(request, 'Viewer')).accessToken;
    driverToken = (await signIn(request, 'Driver')).accessToken;
    await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('DASHZ')}`);
  });

  // LOGI-0012 AC-7
  test('AC-7 — anonymous is 401 with a bearer challenge // LOGI-0012 AC-7', async ({ request }) => {
    expect((await getDashboard(request, null)).status).toBe(401);

    const challenged = await request.get(`${API}/api/v1/dashboard`);
    expect(challenged.status()).toBe(401);
    expect(challenged.headers()['www-authenticate']).toContain('Bearer');
  });

  // LOGI-0012 AC-7
  test('AC-7 — Viewer, Dispatcher and Admin each get 200 with the same body // LOGI-0012 AC-7', async ({
    request,
  }) => {
    const asAdmin = await getDashboard(request, adminToken);
    const asViewer = await getDashboard(request, viewerToken);
    const asDispatcher = await getDashboard(request, dispatcherToken);

    expect(asAdmin.status).toBe(200);
    expect(asViewer.status).toBe(200);
    expect(asDispatcher.status).toBe(200);

    // Read access is not a reduced projection for a Viewer — the org-wide counts are the same ones an
    // Admin sees, byte for byte.
    expect(asViewer.body.statusCounts).toEqual(asAdmin.body.statusCounts);
    expect(asViewer.body.vehicleUtilization).toEqual(asAdmin.body.vehicleUtilization);
    expect(asViewer.body.driverUtilization).toEqual(asAdmin.body.driverUtilization);
    expect(asDispatcher.body.statusCounts).toEqual(asAdmin.body.statusCounts);
  });

  // LOGI-0012 AC-7
  test('AC-7 — a Driver is 403 on the org-wide dashboard // LOGI-0012 AC-7', async ({ request }) => {
    const refused = await getDashboard(request, driverToken);

    // §7 O1: the dashboard is org-wide, so a Driver is refused it outright rather than being handed a
    // silently own-route-scoped version whose counts would mean something else.
    expect(refused.status).toBe(403);
    // The refusal is generic on purpose: naming the role in the body would confirm to a caller which
    // role they hold, so the message stays role-neutral. The STATUS is the contract, not the wording.
    expect(refused.body.title ?? '').toBe('Forbidden');
    expect(refused.body.detail ?? '').toMatch(/not permitted/i);
  });

  // LOGI-0012 AC-7
  test('AC-7 — the surface is read-only: every write verb is 405, not a silent 404 // LOGI-0012 AC-7', async ({
    request,
  }) => {
    // AC-7/AC-8: "read-only" is a statement about the SURFACE, so the verb must be refused as not-allowed
    // rather than reported as a missing route — the two are different contracts.
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      const result = await sendDashboardVerb(request, adminToken, verb);
      expect(result.status, `${verb.toUpperCase()} /api/v1/dashboard must be 405`).toBe(405);
      expect(result.allow ?? '').toContain('GET');
    }

    // ...and GET, the one allowed verb, still works.
    expect((await sendDashboardVerb(request, adminToken, 'get')).status).toBe(200);
  });

  // LOGI-0012 AC-7
  test('AC-7 — a Driver is refused before any data is computed // LOGI-0012 AC-7', async ({ request }) => {
    // The refusal must not depend on the filters: an unauthorized caller must not be able to use a
    // narrow filter as an oracle for whether rows exist.
    for (const query of ['', '?status=Pending', '?pageSize=1']) {
      expect((await getDashboard(request, driverToken, query)).status, `for "${query}"`).toBe(403);
    }
  });
});