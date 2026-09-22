import { expect, test, type APIRequestContext } from '@playwright/test';
import { DriversPage } from './pages/drivers.page';
import { API, authHeaders, seedDriver, signIn } from './support/api';

/**
 * LOGI-0005 Driver CRUD — AC-1..AC-9 against the real API + SPA (no MSW, no mocks).
 *
 * Idiom mirrors `vehicles.spec.ts`: a per-run `token` plus a per-test `Date.now()`
 * suffix keeps every licence unique so the CI retry (`retries: 1`) can neither
 * re-collide on the UNIQUE `license_number` index nor see the previous attempt's rows.
 * Seeded-user ids come from the login response (`signIn` returns the full
 * `TokenResponse`), never hard-coded — the spec's "user id 7" is illustrative.
 */
const token = `e2e${Date.now().toString(36)}`;
const unique = (tag: string) => `${token}-${tag}-${Date.now().toString(36)}`;
// Licence values must fit the 40-char contract limit: short tag + time suffix +
// a per-call counter, so two calls in the same millisecond can never collide.
let licenceSeq = 0;
const licence = (tag: string) => `${tag}${Date.now().toString(36)}${(licenceSeq++).toString(36)}`.slice(0, 20).toUpperCase();

type PagedDrivers = {
  items: { id: number; fullName: string; licenseNumber: string; status: string; userId: number | null }[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
};

test.describe('LOGI-0005 Driver CRUD', () => {
  let drivers: DriversPage;
  let adminToken: string;

  test.beforeEach(async ({ page, request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    drivers = new DriversPage(page);
    // Sign in through the UI (the screen is behind auth since LOGI-0003).
    await drivers.goto('Admin');
  });

  /** Seeds a driver directly through the API (fast path, not UI). Returns its id. */
  async function seed(request: APIRequestContext, name: string, lic: string, overrides: Record<string, unknown> = {}): Promise<number> {
    return seedDriver(request, adminToken, name, lic, overrides);
  }

  /** Total driver rows visible to the admin client (unfiltered). */
  async function countAll(request: APIRequestContext): Promise<number> {
    const response = await request.get(`${API}/api/v1/drivers?page=1&pageSize=1`, {
      headers: authHeaders(adminToken),
    });
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as PagedDrivers).totalCount;
  }

  // AC-1 — create a driver via the UI as Dispatcher and see it persisted (spec section 2/AC-1).
  test('AC-1 — create a driver via the UI and see it in the list', async ({ page, request }) => {
    const name = unique('AC1');
    const lic = licence('DL');

    await drivers.goto('Dispatcher');
    await drivers.openCreate();
    await drivers.nameInput().fill(name);
    await drivers.licenseInput().fill(lic);
    await drivers.phoneInput().fill('+31 6 1234 5678');
    await drivers.submitCreate();

    await drivers.expectToast('Driver created');
    await expect(drivers.row(name)).toBeVisible();
    await expect(drivers.row(name).getByRole('cell', { name: lic, exact: true })).toBeVisible();
    await expect(drivers.row(name).getByRole('cell', { name: 'Active', exact: true })).toBeVisible();

    const list = await request.get(`${API}/api/v1/drivers?q=${encodeURIComponent(name)}`, {
      headers: authHeaders(adminToken),
    });
    expect(list.status()).toBe(200);
    const body = (await list.json()) as PagedDrivers;
    expect(body.items[0].fullName).toBe(name);
    expect(body.items[0].licenseNumber).toBe(lic);
    expect(body.items[0].status).toBe('Active');
  });

  // AC-2 — empty fullName rejected client-side; the API answers 400 errors.fullName, no row.
  test('AC-2 — empty full name is rejected with a validation message', async ({ request }) => {
    await drivers.openCreate();
    await drivers.licenseInput().fill(licence('DL'));
    await drivers.submitCreate();

    await expect(drivers.fieldError(/full name is required/i)).toBeVisible();
    await expect(drivers.page.getByRole('heading', { name: 'Create Driver' })).toBeVisible();

    const before = await countAll(request);
    const response = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: '', licenseNumber: licence('DL') },
    });
    expect(response.status()).toBe(400);
    const problem = (await response.json()) as { errors?: Record<string, string[]> };
    expect(Object.keys(problem.errors ?? {})).toContain('fullName');
    expect(await countAll(request)).toBe(before);
  });

  // AC-3 — duplicate licence rejected with 409 on POST (UI dialog-level alert: the
  // API 409 carries no `errors` map) and on PUT of another driver; counts unchanged.
  test('AC-3 — duplicate licence number is rejected with 409 and leaves no extra row', async ({ request }) => {
    const lic = licence('DUP');
    await seed(request, unique('First'), lic);
    // Re-enter the screen so the list is fetched after the seed (vehicles-suite idiom).
    await drivers.goto('Admin');

    await drivers.openCreate();
    await drivers.nameInput().fill(unique('Copy'));
    await drivers.licenseInput().fill(lic);
    await drivers.submitCreate();

    await expect(drivers.page.getByText(/already exists/i)).toBeVisible();
    await drivers.closeDialog();

    const before = await countAll(request);
    const dupPost = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: unique('Second'), licenseNumber: lic },
    });
    expect(dupPost.status()).toBe(409);
    expect(await countAll(request)).toBe(before);

    // PUT of another driver with the taken licence -> 409, and it keeps its own licence.
    const otherLic = licence('OTH');
    const otherId = await seed(request, unique('Other'), otherLic);
    const dupPut = await request.put(`${API}/api/v1/drivers/${otherId}`, {
      headers: authHeaders(adminToken),
      data: { fullName: unique('Other2'), licenseNumber: lic, status: 'Active' },
    });
    expect(dupPut.status()).toBe(409);
    const kept = await request.get(`${API}/api/v1/drivers/${otherId}`, {
      headers: authHeaders(adminToken),
    });
    expect(((await kept.json()) as { licenseNumber: string }).licenseNumber).toBe(otherLic);
  });

  // AC-4 — omitted status defaults to Active; a status outside the enum is 400 errors.status.
  // The dialog only offers enum values, so the out-of-range case is API-level.
  test('AC-4 — omitted status defaults to Active and a bad status is rejected', async ({ request }) => {
    const created = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: unique('Defaulted'), licenseNumber: licence('DL') },
    });
    expect(created.status()).toBe(201);
    expect(((await created.json()) as { status: string }).status).toBe('Active');

    const bad = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: unique('Bad'), licenseNumber: licence('BS'), status: 'Sleeping' },
    });
    expect(bad.status()).toBe(400);
    const problem = (await bad.json()) as { errors?: Record<string, string[]> };
    expect(Object.keys(problem.errors ?? {})).toContain('status');
  });

  // AC-5 — link to a real seeded user id: 201 echoes userId, GET /{id} carries it,
  // and the UI row shows the User ID cell.
  test('AC-5 — a driver linked to a seeded user echoes userId', async ({ request }) => {
    const userId = (await signIn(request, 'Driver')).user.id;
    const name = unique('Linked');
    const lic = licence('DL');

    const created = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: name, licenseNumber: lic, userId },
    });
    expect(created.status()).toBe(201);
    const createdBody = (await created.json()) as { id: number; userId: number };
    expect(createdBody.userId).toBe(userId);

    const fetched = await request.get(`${API}/api/v1/drivers/${createdBody.id}`, {
      headers: authHeaders(adminToken),
    });
    expect(((await fetched.json()) as { userId: number }).userId).toBe(userId);

    await drivers.search(name);
    await expect(drivers.rowById(createdBody.id)).toBeVisible();
    await expect(drivers.rowById(createdBody.id).getByRole('cell', { name: String(userId), exact: true })).toBeVisible();
  });

  // AC-6 — broken link 400, taken link 409 on POST and PUT (self excluded),
  // PUT userId null clears the link.
  test('AC-6 — broken, taken and cleared user links behave per contract', async ({ request }) => {
    const before = await countAll(request);

    // Nonexistent userId -> 400 errors.userId, no row.
    const broken = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: unique('Broken'), licenseNumber: licence('U4'), userId: 999999 },
    });
    expect(broken.status()).toBe(400);
    const brokenBody = (await broken.json()) as { errors?: Record<string, string[]> };
    expect(Object.keys(brokenBody.errors ?? {})).toContain('userId');
    expect(await countAll(request)).toBe(before);

    // The holder keeps the link; a retry finds whichever driver holds it and
    // clears first, so the POST below can never inherit a previous attempt's link.
    const userId = (await signIn(request, 'Dispatcher')).user.id;
    const holding = await request.get(`${API}/api/v1/drivers?page=1&pageSize=100`, {
      headers: authHeaders(adminToken),
    });
    for (const item of ((await holding.json()) as PagedDrivers).items) {
      if (item.userId === userId) {
        const current = (await (await request.get(`${API}/api/v1/drivers/${item.id}`, {
          headers: authHeaders(adminToken),
        })).json()) as { fullName: string; licenseNumber: string; status: string };
        await request.put(`${API}/api/v1/drivers/${item.id}`, {
          headers: authHeaders(adminToken),
          data: { ...current, userId: null },
        });
      }
    }
    const holderId = await seed(request, unique('Holder'), licence('U1'), { userId });

    const takenPost = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(adminToken),
      data: { fullName: unique('Taken'), licenseNumber: licence('UT'), userId },
    });
    expect(takenPost.status()).toBe(409);

    const otherId = await seed(request, unique('Other'), licence('UO'));
    const other = (await (await request.get(`${API}/api/v1/drivers/${otherId}`, {
      headers: authHeaders(adminToken),
    })).json()) as { fullName: string; licenseNumber: string; status: string };
    const takenPut = await request.put(`${API}/api/v1/drivers/${otherId}`, {
      headers: authHeaders(adminToken),
      data: { ...other, userId },
    });
    expect(takenPut.status()).toBe(409);

    // PUT with userId null clears the link (self excluded from the 1:1 check).
    const holder = (await (await request.get(`${API}/api/v1/drivers/${holderId}`, {
      headers: authHeaders(adminToken),
    })).json()) as { fullName: string; licenseNumber: string; status: string };
    const cleared = await request.put(`${API}/api/v1/drivers/${holderId}`, {
      headers: authHeaders(adminToken),
      data: { ...holder, userId: null },
    });
    expect(cleared.status()).toBe(200);
    expect(((await cleared.json()) as { userId: number | null }).userId).toBeNull();
  });

  // AC-7 — 30 prefixed drivers: page 2 of 10 is exact (page/pageSize/totalCount/
  // totalPages, ids ascending and disjoint from page 1); status narrows to 10;
  // a bad status is 400; the UI search + status filter narrow the visible rows.
  test('AC-7 — list is paged and filterable by name and status', async ({ request }) => {
    const prefix = unique('AC7');
    // Licence values cap at 20 chars, so the seed keeps the full unique prefix in
    // the *name* (q filters names) and uses a short fixed tag + index for the licence.
    const licTag = `A7${Date.now().toString(36)}`.slice(0, 8).toUpperCase();
    const statuses = ['Active', 'OffDuty', 'Suspended'] as const;
    for (let i = 0; i < 30; i++) {
      await seed(request, `${prefix} Driver ${i}`, `${licTag}${String(i).padStart(2, '0')}`, {
        status: statuses[i % 3],
      });
    }

    const page2 = await request.get(
      `${API}/api/v1/drivers?q=${encodeURIComponent(prefix)}&page=2&pageSize=10`,
      { headers: authHeaders(adminToken) },
    );
    expect(page2.status()).toBe(200);
    const page2Body = (await page2.json()) as PagedDrivers;
    expect(page2Body.items).toHaveLength(10);
    expect(page2Body.page).toBe(2);
    expect(page2Body.pageSize).toBe(10);
    expect(page2Body.totalCount).toBe(30);
    expect(page2Body.totalPages).toBe(3);
    const page2Ids = page2Body.items.map((item) => item.id);
    expect([...page2Ids].sort((a, b) => a - b)).toEqual(page2Ids);

    const page1 = await request.get(
      `${API}/api/v1/drivers?q=${encodeURIComponent(prefix)}&page=1&pageSize=10`,
      { headers: authHeaders(adminToken) },
    );
    const page1Ids = ((await page1.json()) as PagedDrivers).items.map((item) => item.id);
    expect(page1Ids.filter((id) => page2Ids.includes(id))).toHaveLength(0);

    const suspended = await request.get(
      `${API}/api/v1/drivers?q=${encodeURIComponent(prefix)}&page=1&pageSize=100&status=Suspended`,
      { headers: authHeaders(adminToken) },
    );
    const suspendedBody = (await suspended.json()) as PagedDrivers;
    expect(suspendedBody.totalCount).toBe(10);
    for (const item of suspendedBody.items) expect(item.status).toBe('Suspended');

    const badStatus = await request.get(`${API}/api/v1/drivers?page=1&pageSize=10&status=Nope`, {
      headers: authHeaders(adminToken),
    });
    expect(badStatus.status()).toBe(400);

    // UI: search by prefix then narrow by status.
    await drivers.goto('Admin');
    await drivers.search(prefix);
    await expect(drivers.row(`${prefix} Driver 0`)).toBeVisible();
    await drivers.filterByStatus('Suspended');
    await expect(drivers.row(`${prefix} Driver 2`)).toBeVisible();
    await expect(drivers.row(`${prefix} Driver 0`)).toHaveCount(0);
  });

  // AC-8 — UI round-trip (search, edit status/phone, toast, delete, toast) plus
  // API 404s on GET/PUT/DELETE of a missing id.
  test('AC-8 — get, update, delete round-trip with 404s', async ({ request }) => {
    const name = unique('RT');
    const lic = licence('DL');
    await seed(request, name, lic);
    await drivers.goto('Admin');
    // The run may hold more than 5 drivers (default page size): narrow first.
    await drivers.search(name);

    await drivers.openEdit(name);
    await drivers.phoneInput().fill('+31 6 0000 0000');
    await drivers.selectStatus('OffDuty');
    await drivers.saveEdit();
    await drivers.expectToast('Driver updated');

    await expect(drivers.row(name).getByRole('cell', { name: 'OffDuty', exact: true })).toBeVisible();
    await expect(drivers.row(name).getByRole('cell', { name: '+31 6 0000 0000', exact: true })).toBeVisible();

    await drivers.deleteRow(name);
    await drivers.expectToast('Driver deleted');
    await expect(drivers.row(name)).not.toBeVisible();

    for (const pending of [
      request.get(`${API}/api/v1/drivers/999999`, { headers: authHeaders(adminToken) }),
      request.put(`${API}/api/v1/drivers/999999`, {
        headers: authHeaders(adminToken),
        data: { fullName: 'Ghost', licenseNumber: licence('GH'), status: 'Active' },
      }),
      request.delete(`${API}/api/v1/drivers/999999`, { headers: authHeaders(adminToken) }),
    ]) {
      const response = await pending;
      expect(response.status()).toBe(404);
      expect(((await response.json()) as { title: string }).title).toBe('Resource not found');
    }
  });

  // AC-9 — RBAC from day one: anonymous 401, Viewer reads but cannot write (403),
  // the Driver role is 403 even on reads, Dispatcher creates/updates but cannot
  // delete (403), Admin deletes (204 then subsequent GET 404). The UI mirrors the
  // same matrix by hiding affordances — hidden is not secure, the API 403s are proof.
  test('AC-9 — anonymous 401, Viewer read-only, Driver 403 on reads, Dispatcher no delete, Admin can', async ({
    request,
    browser,
  }) => {
    const name = unique('RBAC');
    const id = await seed(request, name, licence('DL'));

    // Anonymous — rejected before authorization even matters (LOGI-0003 behaviour).
    for (const pending of [
      request.get(`${API}/api/v1/drivers`),
      request.get(`${API}/api/v1/drivers/${id}`),
      request.post(`${API}/api/v1/drivers`, {
        data: { fullName: unique('Anon'), licenseNumber: licence('AN') },
      }),
      request.put(`${API}/api/v1/drivers/${id}`, {
        data: { fullName: unique('Anon'), licenseNumber: licence('AN'), status: 'Active' },
      }),
      request.delete(`${API}/api/v1/drivers/${id}`),
    ]) {
      expect((await pending).status()).toBe(401);
    }
    expect((await request.get(`${API}/api/v1/drivers`)).headers()['www-authenticate']).toContain('Bearer');

    // Viewer — list plus detail 200, writes 403 with the row count unchanged.
    const viewerToken = (await signIn(request, 'Viewer')).accessToken;
    expect((await request.get(`${API}/api/v1/drivers?q=${encodeURIComponent(name)}`, {
      headers: authHeaders(viewerToken),
    })).status()).toBe(200);
    expect((await request.get(`${API}/api/v1/drivers/${id}`, {
      headers: authHeaders(viewerToken),
    })).status()).toBe(200);
    const before = await countAll(request);
    expect((await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(viewerToken),
      data: { fullName: unique('Viewer'), licenseNumber: licence('VW') },
    })).status()).toBe(403);
    expect(await countAll(request)).toBe(before);

    // Driver role — 403 even on reads (master data is not a driver-persona surface).
    const driverToken = (await signIn(request, 'Driver')).accessToken;
    expect((await request.get(`${API}/api/v1/drivers`, {
      headers: authHeaders(driverToken),
    })).status()).toBe(403);
    expect((await request.get(`${API}/api/v1/drivers/${id}`, {
      headers: authHeaders(driverToken),
    })).status()).toBe(403);

    // Dispatcher — GET/POST/PUT 2xx, DELETE 403.
    const dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
    expect((await request.get(`${API}/api/v1/drivers/${id}`, {
      headers: authHeaders(dispatcherToken),
    })).status()).toBe(200);
    const dispatcherPost = await request.post(`${API}/api/v1/drivers`, {
      headers: authHeaders(dispatcherToken),
      data: { fullName: unique('Created'), licenseNumber: licence('DP') },
    });
    expect(dispatcherPost.status()).toBe(201);
    const dispatcherCreated = (await dispatcherPost.json()) as { id: number; licenseNumber: string };
    expect((await request.put(`${API}/api/v1/drivers/${dispatcherCreated.id}`, {
      headers: authHeaders(dispatcherToken),
      data: { fullName: unique('Updated'), licenseNumber: dispatcherCreated.licenseNumber, status: 'Active' },
    })).status()).toBe(200);
    await request.delete(`${API}/api/v1/drivers/${dispatcherCreated.id}`, {
      headers: authHeaders(adminToken),
    });
    expect((await request.delete(`${API}/api/v1/drivers/${id}`, {
      headers: authHeaders(dispatcherToken),
    })).status()).toBe(403);

    // UI affordances mirror the matrix: the Driver role has no tab; Viewer has
    // no New/Edit/Delete; Dispatcher has New but no Delete.
    const driverUi = new DriversPage(await browser.newPage());
    await driverUi.login.signInAs('Driver');
    await expect(driverUi.page.getByTestId('tab-drivers')).toHaveCount(0);
    await driverUi.page.close();

    const viewerUi = new DriversPage(await browser.newPage());
    await viewerUi.goto('Viewer');
    await viewerUi.search(name);
    await expect(viewerUi.page.getByTestId('new-driver')).toHaveCount(0);
    await expect(viewerUi.row(name).getByRole('button', { name: /edit driver/i })).toHaveCount(0);
    await viewerUi.page.close();

    const dispatcherUi = new DriversPage(await browser.newPage());
    await dispatcherUi.goto('Dispatcher');
    await expect(dispatcherUi.page.getByTestId('new-driver')).toBeVisible();
    await dispatcherUi.search(name);
    await expect(dispatcherUi.row(name).getByRole('button', { name: /delete driver/i })).toHaveCount(0);
    await dispatcherUi.page.close();

    // Admin — delete succeeds and the driver is gone.
    expect((await request.delete(`${API}/api/v1/drivers/${id}`, {
      headers: authHeaders(adminToken),
    })).status()).toBe(204);
    expect((await request.get(`${API}/api/v1/drivers/${id}`, {
      headers: authHeaders(adminToken),
    })).status()).toBe(404);
  });
});
