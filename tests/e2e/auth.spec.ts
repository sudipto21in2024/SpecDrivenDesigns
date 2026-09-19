import { expect, test } from '@playwright/test';
import { LoginPage } from './pages/login.page';
import { WarehousesPage } from './pages/warehouses.page';
import { API, SEED_PASSWORD, SEED_USERS, authHeaders, seedWarehouse, signIn } from './support/api';

/**
 * LOGI-0003 auth & RBAC end-to-end tests, run against the real stack (ASP.NET Core + SQLite + the
 * built SPA). These deliberately drive the UI the way a user would, because the point of the ticket
 * is that *browsers* are gated, not just the API.
 *
 * localStorage persists per origin across tests in a worker, so every test that needs to start
 * anonymous calls LoginPage.gotoAnonymous() rather than goto().
 */
test.describe('LOGI-0003 Auth & roles', () => {
  const token = `e2eauth${Date.now().toString(36)}`;

  // ---------------------------------------------------------------- AC-12: gating

  test('AC-12: an anonymous visitor lands on the login screen', async ({ page }) => {
    const login = new LoginPage(page);
    await login.gotoAnonymous();

    // The protected domain screen must not be reachable without signing in.
    await expect(page.getByRole('heading', { name: 'Warehouses' })).toBeHidden();
    await expect(login.signInButton()).toBeVisible();
  });

  // ---------------------------------------------------------------- AC-1: sign in

  test('AC-1: signing in with valid credentials reveals the app shell', async ({ page }) => {
    const login = new LoginPage(page);
    await login.gotoAnonymous();
    await login.signIn('Dispatcher');

    await expect(page.getByTestId('current-role')).toHaveText('Dispatcher');
    await expect(page.getByTestId('current-user')).toContainText('Dana Doolittle');
    await expect(page.getByRole('heading', { name: 'Warehouses' })).toBeVisible();
  });

  // ---------------------------------------------------------------- AC-2: rejection

  test('AC-2: a wrong password is rejected with a generic message', async ({ page }) => {
    const login = new LoginPage(page);
    await login.gotoAnonymous();

    await login.emailInput().fill(SEED_USERS.Admin);
    await login.passwordInput().fill('definitely-not-the-password');
    await login.signInButton().click();

    await expect(login.errorAlert()).toContainText('Invalid email or password.');
    // Still on the login screen, with no session established.
    await expect(page.getByTestId('current-role')).toBeHidden();
  });

  // ---------------------------------------------------------------- AC-9: sign out

  test('AC-9: signing out returns to the login screen', async ({ page }) => {
    const warehouses = new WarehousesPage(page);
    await warehouses.goto('Admin');

    await warehouses.signOut();

    // Reloading must not resurrect the session: the client-side tokens were cleared.
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in to LogiFlow' })).toBeVisible();
  });

  // ---------------------------------------------------------------- AC-12: role-aware UI

  test('AC-12: a Viewer can read warehouses but sees no write controls', async ({ page, request }) => {
    const name = `${token} Viewer Read`;
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    await seedWarehouse(request, adminToken, name);

    const warehouses = new WarehousesPage(page);
    await warehouses.goto('Viewer');

    // The table pages 5 rows at a time and the shared DB accumulates rows, so pull the seeded row
    // into view via a server-side search before asserting on the affordances around it.
    await warehouses.findRow(name);
    await expect(page.getByTestId('new-warehouse')).toBeHidden();
    await expect(page.getByRole('button', { name: `Edit warehouse ${name}` })).toBeHidden();
    await expect(page.getByRole('button', { name: `Delete warehouse ${name}` })).toBeHidden();
  });

  test('AC-12: a Dispatcher can create but cannot delete', async ({ page, request }) => {
    const name = `${token} Dispatcher Seed`;
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    await seedWarehouse(request, adminToken, name);

    const warehouses = new WarehousesPage(page);
    await warehouses.goto('Dispatcher');

    // The seeded row may sit beyond page 1 (5 rows/page, shared DB) — search it into view first.
    await warehouses.findRow(name);

    // Write affordances are present...
    await expect(page.getByTestId('new-warehouse')).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit warehouse ${name}` })).toBeVisible();
    // ...but DELETE is Admin-only per x-roles: [Admin].
    await expect(page.getByRole('button', { name: `Delete warehouse ${name}` })).toBeHidden();
  });

  test('AC-12: an Admin sees the complete set of controls', async ({ page, request }) => {
    const name = `${token} Admin Full`;
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    await seedWarehouse(request, adminToken, name);

    const warehouses = new WarehousesPage(page);
    await warehouses.goto('Admin');

    // The seeded row may sit beyond page 1 (5 rows/page, shared DB) — search it into view first.
    await warehouses.findRow(name);

    await expect(page.getByTestId('new-warehouse')).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit warehouse ${name}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Delete warehouse ${name}` })).toBeVisible();
  });

  // ---------------------------------------------------------------- AC-4 / AC-5 / AC-6: API enforcement

  test('AC-4: protected endpoints return 401 with a bearer challenge without a token', async ({ request }) => {
    const response = await request.get(`${API}/api/v1/warehouses`);
    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toContain('Bearer');

    const problem = (await response.json()) as { status: number; type: string };
    expect(problem.status).toBe(401);
    expect(problem.type).toContain('unauthorized');
  });

  test('AC-5: a Viewer is refused write access with a 403 ProblemDetails', async ({ request }) => {
    const viewerToken = (await signIn(request, 'Viewer')).accessToken;

    const response = await request.post(`${API}/api/v1/warehouses`, {
      headers: authHeaders(viewerToken),
      data: { name: `${token} Should Not Exist`, address: 'Nowhere' },
    });

    expect(response.status()).toBe(403);
    const problem = (await response.json()) as { status: number; title: string };
    expect(problem.status).toBe(403);
    expect(problem.title).toBe('Forbidden');
  });

  test('AC-6: DELETE is refused for a Dispatcher and allowed for an Admin', async ({ request }) => {
    const adminToken = (await signIn(request, 'Admin')).accessToken;
    const dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;

    const id = await seedWarehouse(request, adminToken, `${token} Delete Matrix`);

    const forbidden = await request.delete(`${API}/api/v1/warehouses/${id}`, {
      headers: authHeaders(dispatcherToken),
    });
    expect(forbidden.status()).toBe(403);

    // The rejected delete must not have removed anything.
    const stillThere = await request.get(`${API}/api/v1/warehouses/${id}`, { headers: authHeaders(adminToken) });
    expect(stillThere.status()).toBe(200);

    const allowed = await request.delete(`${API}/api/v1/warehouses/${id}`, { headers: authHeaders(adminToken) });
    expect(allowed.status()).toBe(204);
  });

  // ---------------------------------------------------------------- AC-7 / AC-9: token lifecycle

  test('AC-7: a refresh token can be rotated once and replaying it fails', async ({ request }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: SEED_USERS.Admin, password: SEED_PASSWORD },
    });
    expect(login.status()).toBe(200);
    const first = (await login.json()) as { refreshToken: string; accessToken: string };

    const rotated = await request.post(`${API}/api/v1/auth/refresh`, {
      data: { refreshToken: first.refreshToken },
    });
    expect(rotated.status()).toBe(200);
    const second = (await rotated.json()) as { refreshToken: string; accessToken: string };
    expect(second.refreshToken).not.toBe(first.refreshToken);

    // Rotation is single-use: the presented token is now revoked.
    const replayed = await request.post(`${API}/api/v1/auth/refresh`, {
      data: { refreshToken: first.refreshToken },
    });
    expect(replayed.status()).toBe(401);

    // The rotated pair still works.
    const me = await request.get(`${API}/api/v1/auth/me`, { headers: authHeaders(second.accessToken) });
    expect(me.status()).toBe(200);
    const identity = (await me.json()) as { email: string; role: string };
    expect(identity.email).toBe(SEED_USERS.Admin);
    expect(identity.role).toBe('Admin');
  });

  test('AC-9: a revoked refresh token can no longer be exchanged', async ({ request }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: SEED_USERS.Viewer, password: SEED_PASSWORD },
    });
    const { refreshToken } = (await login.json()) as { refreshToken: string };

    const logout = await request.post(`${API}/api/v1/auth/logout`, { data: { refreshToken } });
    expect(logout.status()).toBe(204);

    const after = await request.post(`${API}/api/v1/auth/refresh`, { data: { refreshToken } });
    expect(after.status()).toBe(401);
  });

  // ---------------------------------------------------------------- AC-10: no credential leakage

  test('AC-10: no auth response exposes credential material', async ({ request }) => {
    const login = await request.post(`${API}/api/v1/auth/login`, {
      data: { email: SEED_USERS.Admin, password: SEED_PASSWORD },
    });
    const body = (await login.json()) as Record<string, unknown>;
    const user = body.user as Record<string, unknown>;

    for (const field of ['passwordHash', 'securityStamp', 'concurrencyStamp', 'password', 'accessFailedCount']) {
      expect(user).not.toHaveProperty(field);
    }
    expect(Object.keys(user).sort()).toEqual(['email', 'fullName', 'id', 'role']);
  });
});