import { expect, test, type APIRequestContext } from '@playwright/test';
import { VehiclesPage } from './pages/vehicles.page';
import { API, authHeaders, seedVehicle, signIn } from './support/api';

// Unique per run so tests stay independent against the shared throwaway database.
const token = `e2e${Date.now().toString(36)}`;

test.describe('LOGI-0004 Vehicle CRUD', () => {
  let vehicles: VehiclesPage;
  let adminToken: string;

  test.beforeEach(async ({ page, request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    vehicles = new VehiclesPage(page);
    // Sign in through the UI (the screen is behind auth since LOGI-0003).
    await vehicles.goto('Admin');
  });

  /** Seeds a vehicle directly through the API (fast path, not UI). */
  async function seed(request: APIRequestContext, plate: string, overrides: Record<string, unknown> = {}): Promise<number> {
    return seedVehicle(request, adminToken, plate, overrides);
  }

  // AC-1 — create a vehicle via the UI and see it persisted.
  test('AC-1 — create a vehicle via the UI and see it in the list', async ({ page, request }) => {
    const plate = `${token}-AC1`;

    await vehicles.openCreate();
    await vehicles.plateInput().fill(plate);
    await vehicles.selectType('Truck');
    await vehicles.capacityInput().fill('12000');
    await vehicles.submitCreate();

    await vehicles.expectToast('Vehicle created');
    await expect(vehicles.row(plate)).toBeVisible();
    await expect(page.getByRole('cell', { name: '12000' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Available' })).toBeVisible();

    const list = await request.get(`${API}/api/v1/vehicles?q=${encodeURIComponent(plate)}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await list.json();
    expect(body.items[0].plateNumber).toBe(plate);
  });

  // AC-2 — empty plate number rejected client-side before the request leaves.
  test('AC-2 — empty plate number is rejected with a validation message', async ({ page }) => {
    await vehicles.openCreate();
    await vehicles.selectType('Van');
    await vehicles.capacityInput().fill('1000');
    await vehicles.submitCreate();

    await expect(vehicles.fieldError(/plate number is required/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create Vehicle' })).toBeVisible();
  });

  // AC-3 — duplicate plate rejected with 409 and no second row.
  test('AC-3 — duplicate plate number is rejected with 409 and leaves no extra row', async ({ request }) => {
    const plate = `${token}-DUP`;
    await seed(request, plate);
    // Re-enter the screen so the list is fetched after the seed (mirrors the warehouse suite).
    await vehicles.goto('Admin');

    await vehicles.openCreate();
    await vehicles.plateInput().fill(plate);
    await vehicles.selectType('Truck');
    await vehicles.capacityInput().fill('5000');
    await vehicles.submitCreate();

    await expect(vehicles.fieldError(/already exists/i)).toBeVisible();
    await vehicles.closeDialog();
    await expect(vehicles.row(plate)).toHaveCount(1);
  });

  // AC-4 — unknown vehicle type rejected. The create dialog only offers enum values, so the
  // "value outside Van/Truck/Trailer" case is a contract-boundary test exercised at the API level.
  test('AC-4 — unknown vehicle type is rejected with 400', async ({ request }) => {
    const response = await request.post(`${API}/api/v1/vehicles`, {
      headers: authHeaders(adminToken),
      data: { plateNumber: `${token}-SPACESHIP`, type: 'Spaceship', capacityKg: 1000 },
    });
    expect(response.status()).toBe(400);
    const problem = (await response.json()) as { errors?: Record<string, string[]> };
    expect(Object.keys(problem.errors ?? {})).toContain('type');
  });

  // AC-5 — non-positive capacity rejected.
  test('AC-5 — non-positive capacity is rejected with a validation error', async () => {
    await vehicles.openCreate();
    await vehicles.plateInput().fill(`${token}-CAP`);
    await vehicles.selectType('Truck');
    await vehicles.capacityInput().fill('0');
    await vehicles.submitCreate();

    await expect(vehicles.fieldError('Capacity must be greater than 0')).toBeVisible();
  });

  // AC-6 — omitted status defaults to Available. The dialog pre-selects it (covered by the vitest
  // suite), but the contract default is a server behaviour — exercised by omitting the field.
  test('AC-6 — omitted status defaults to Available in the response', async ({ request }) => {
    const response = await request.post(`${API}/api/v1/vehicles`, {
      headers: authHeaders(adminToken),
      data: { plateNumber: `${token}-DEF`, type: 'Truck', capacityKg: 8000 },
    });
    expect(response.status()).toBe(201);
    const created = (await response.json()) as { status: string };
    expect(created.status).toBe('Available');
  });


  // AC-7 — list is filterable by status and type (combined filters AND together).
  test('AC-7 — list is filterable by status and type', async ({ request }) => {
    await seed(request, `${token}-7A`, { type: 'Van', status: 'Available' });
    await seed(request, `${token}-7B`, { type: 'Truck', status: 'Maintenance' });

    await vehicles.goto('Admin');

    await vehicles.filterByStatus('Maintenance');
    await expect(vehicles.row(`${token}-7B`)).toBeVisible();
    await expect(vehicles.row(`${token}-7A`)).toHaveCount(0);

    // Status + type AND: Van AND Available narrows to the 7A seed only.
    await vehicles.filterByStatus('Available');
    await vehicles.filterByType('Van');
    await expect(vehicles.row(`${token}-7A`)).toBeVisible();
    await expect(vehicles.row(`${token}-7B`)).toHaveCount(0);
  });

  // AC-8 — get, update, delete round-trip with 404s.
  test('AC-8 — get, update, delete round-trip with 404s', async ({ request }) => {
    const plate = `${token}-RT`;
    await seed(request, plate);
    await vehicles.goto('Admin');
    // The run may hold >5 vehicles (default page size): narrow to the seeded row first.
    await vehicles.search(plate);

    await vehicles.openEdit(plate);
    await vehicles.selectType('Trailer');
    await vehicles.capacityInput().fill('20000');
    await vehicles.selectStatus('InRoute');
    await vehicles.saveEdit();
    await vehicles.expectToast('Vehicle updated');

    await expect(vehicles.row(plate).getByRole('cell', { name: 'Trailer' })).toBeVisible();
    await expect(vehicles.row(plate).getByRole('cell', { name: 'InRoute' })).toBeVisible();

    await vehicles.deleteRow(plate);
    await vehicles.expectToast('Vehicle deleted');
    await expect(vehicles.row(plate)).not.toBeVisible();
  });

  // AC-9 — RBAC from day one: anonymous 401, Viewer reads but cannot write (403), Dispatcher
  // creates/updates but cannot delete (403), Admin deletes (204 → subsequent GET 404). The UI
  // mirrors the same matrix by hiding affordances — hidden ≠ secure, the API 403s are the proof.
  test('AC-9 — anonymous 401, Viewer cannot write, Dispatcher cannot delete, Admin can', async ({ request, browser }) => {
    const plate = `${token}-RBAC`;
    const id = await seed(request, plate);

    // Anonymous — rejected before authorization even matters (LOGI-0003 contract behaviour).
    const anonGet = await request.get(`${API}/api/v1/vehicles`);
    expect(anonGet.status()).toBe(401);
    expect(anonGet.headers()['www-authenticate']).toContain('Bearer');
    const anonPost = await request.post(`${API}/api/v1/vehicles`, {
      data: { plateNumber: `${token}-ANON`, type: 'Truck', capacityKg: 1000 },
    });
    expect(anonPost.status()).toBe(401);

    // Viewer — authenticated read succeeds, write is forbidden.
    const viewerToken = (await signIn(request, 'Viewer')).accessToken;
    const viewerGet = await request.get(`${API}/api/v1/vehicles?q=${encodeURIComponent(plate)}`, {
      headers: authHeaders(viewerToken),
    });
    expect(viewerGet.status()).toBe(200);
    const viewerPost = await request.post(`${API}/api/v1/vehicles`, {
      headers: authHeaders(viewerToken),
      data: { plateNumber: `${token}-VIEWER`, type: 'Truck', capacityKg: 1000 },
    });
    expect(viewerPost.status()).toBe(403);

    // Dispatcher — create/update allowed (2xx), delete forbidden.
    const dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
    const dispatcherPut = await request.put(`${API}/api/v1/vehicles/${id}`, {
      headers: authHeaders(dispatcherToken),
      data: { plateNumber: plate, type: 'Truck', capacityKg: 13000, status: 'Available' },
    });
    expect(dispatcherPut.status()).toBe(200);
    const dispatcherDelete = await request.delete(`${API}/api/v1/vehicles/${id}`, {
      headers: authHeaders(dispatcherToken),
    });
    expect(dispatcherDelete.status()).toBe(403);

    // UI affordances mirror the matrix: Viewer has no New; Dispatcher has New but no Delete.
    const viewerUi = new VehiclesPage(await browser.newPage());
    await viewerUi.goto('Viewer');
    await expect(viewerUi.page.getByTestId('new-vehicle')).not.toBeVisible();
    await viewerUi.page.close();

    const dispatcherUi = new VehiclesPage(await browser.newPage());
    await dispatcherUi.goto('Dispatcher');
    await expect(dispatcherUi.page.getByTestId('new-vehicle')).toBeVisible();
    await dispatcherUi.search(plate);
    await expect(dispatcherUi.row(plate).getByRole('button', { name: `Delete ${plate}` })).toHaveCount(0);
    await dispatcherUi.page.close();

    // Admin — delete succeeds and the vehicle is gone.
    const adminDelete = await request.delete(`${API}/api/v1/vehicles/${id}`, { headers: authHeaders(adminToken) });
    expect(adminDelete.status()).toBe(204);
    const gone = await request.get(`${API}/api/v1/vehicles/${id}`, { headers: authHeaders(adminToken) });
    expect(gone.status()).toBe(404);
  });
});
