import { expect, test, type APIRequestContext } from '@playwright/test';
import { WarehousesPage } from './pages/warehouses.page';
import { API, authHeaders, seedWarehouse, signIn } from './support/api';

// Unique per run so tests stay independent against the shared throwaway database.
const token = `e2e${Date.now().toString(36)}`;

test.describe('LOGI-0001 Warehouse CRUD', () => {
  let warehouses: WarehousesPage;
  /** Admin access token, used to seed data directly through the API. */
  let adminToken: string;

  test.beforeEach(async ({ page, request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouses = new WarehousesPage(page);
    // Signs in through the UI (the screen is behind authentication since LOGI-0003).
    await warehouses.goto('Admin');
  });

  /** Seeds a warehouse directly through the API (fast path, not UI). */
  async function seed(request: APIRequestContext, name: string, address = '1 Seeded Rd'): Promise<number> {
    return seedWarehouse(request, adminToken, name, address);
  }

  // LOGI-0001 AC-1 — create warehouse via UI, see it in the list.
  test('AC-1: creates a warehouse and shows it in the list', async ({ page }) => {
    const name = `${token} Central DC`;

    await warehouses.openCreate();
    await warehouses.nameInput().fill(name);
    await warehouses.addressInput().fill('12 Industrial Rd, Rotterdam');
    await warehouses.latitudeInput().fill('51.9244');
    await warehouses.page.getByLabel('Warehouse longitude').fill('4.4777');
    await warehouses.submitCreate();

    await warehouses.expectToast('Warehouse created');
    await warehouses.findRow(name);
  });

  // LOGI-0001 AC-2 — required fields enforced (client-side Zod mirrors backend rules).
  test('AC-2: blocks create when name or address is empty', async () => {
    await warehouses.openCreate();
    await warehouses.submitCreate();

    await expect(warehouses.fieldError('Name is required')).toBeVisible();
    await expect(warehouses.fieldError('Address is required')).toBeVisible();
  });

  // LOGI-0001 AC-3 — coordinate ranges validated.
  test('AC-3: rejects out-of-range latitude', async () => {
    await warehouses.openCreate();
    await warehouses.nameInput().fill(`${token} Bad Coords`);
    await warehouses.addressInput().fill('1 Harbor Way');
    await warehouses.latitudeInput().fill('95');
    await warehouses.submitCreate();

    await expect(warehouses.fieldError('Latitude must be between -90 and 90')).toBeVisible();
  });

  // LOGI-0001 AC-4 — list is paginated and name-search filters server-side.
  test('AC-4: name search filters the paged list', async ({ request }) => {
    await seed(request, `${token} Alpha Depot`);
    await seed(request, `${token} Beta Depot`);

    await warehouses.goto();
    await warehouses.search(`${token} Alpha`);

    await expect(warehouses.row(`${token} Alpha Depot`)).toBeVisible();
    await expect(warehouses.row(`${token} Beta Depot`)).toBeHidden();
  });

  // LOGI-0001 AC-5 — get by id / not found (API-level contract behaviour).
  test('AC-5: API returns 404 ProblemDetails for a missing warehouse', async ({ request }) => {
    // Authenticated: a 401 would make this assertion pass for the wrong reason.
    const response = await request.get(`${API}/api/v1/warehouses/999999`, {
      headers: authHeaders(adminToken),
    });
    expect(response.status()).toBe(404);
    const problem = (await response.json()) as { title: string; status: number };
    expect(problem.title).toBe('Resource not found');
    expect(problem.status).toBe(404);
  });

  // LOGI-0003 AC-4 — the same call without a token is rejected.
  test('LOGI-0003 AC-4: the warehouses API rejects an unauthenticated request', async ({ request }) => {
    const response = await request.get(`${API}/api/v1/warehouses`);
    expect(response.status()).toBe(401);
    expect(response.headers()['www-authenticate']).toContain('Bearer');
  });

  // LOGI-0001 AC-6 — full update via the edit dialog.
  test('AC-6: edits an existing warehouse', async ({ request }) => {
    const oldName = `${token} Old Name`;
    const newName = `${token} New Name`;
    await seed(request, oldName, '99 Old Ave');

    await warehouses.goto();
    await warehouses.findRow(oldName);
    await warehouses.openEdit(oldName);
    await warehouses.nameInput().fill(newName);
    await warehouses.saveEdit();

    await warehouses.expectToast('Warehouse updated');

    // The search box still filters by the old name server-side after the rename, so the renamed row
    // never enters the current page: re-search by the new name, then assert the old name is gone.
    await warehouses.findRow(newName);
    await expect(warehouses.row(oldName)).toBeHidden();
  });

  // LOGI-0001 AC-7 — delete with confirmation, row disappears.
  test('AC-7: deletes a warehouse after confirmation', async ({ request }) => {
    const name = `${token} Doomed DC`;
    await seed(request, name, '9 Gone St');

    await warehouses.goto();
    await warehouses.findRow(name);
    await warehouses.deleteRow(name);

    await warehouses.expectToast('Warehouse deleted');
    await expect(warehouses.row(name)).toBeHidden();
  });
});
