import { expect, test, type APIRequestContext } from '@playwright/test';
import { seedWarehouse, signIn } from './support/api';
import { createShipment, listShipments, seedShipmentAt } from './support/shipments';

/**
 * LOGI-0007 F8 — shipment list & search (AC-6..AC-9, AC-10 GET side) against the real API + real
 * SQLite (no MSW, no mocks). Rows are created through the real create endpoint wherever the API can
 * produce them, and seeded straight into the database only where an instant has to be pinned
 * (`sla_due_at = NULL`, or a due date inside the BR-2 window) — see `seedShipmentAt`.
 *
 * Every assertion is scoped to a freshly seeded origin warehouse, so a CI retry (`retries: 1`) can
 * never observe leftovers from a previous attempt.
 */
const runTag = `e2e${Date.now().toString(36)}`;
let sequence = 0;

test.describe('LOGI-0007 shipment list & search', () => {
  let adminToken: string;
  let dispatcherToken: string;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    dispatcherToken = (await signIn(request, 'Dispatcher')).accessToken;
  });

  /** A fresh origin warehouse per test — the scope that keeps every count assertion retry-safe. */
  async function freshWarehouse(request: APIRequestContext): Promise<number> {
    return seedWarehouse(request, adminToken, `${runTag} WH ${sequence++}`);
  }

  /** Creates a shipment through the real endpoint and returns the identity the assertions bind to. */
  async function createRow(
    request: APIRequestContext,
    warehouseId: number,
    overrides: Record<string, unknown> = {},
  ): Promise<{ id: number; referenceCode: string }> {
    const created = await createShipment(request, dispatcherToken, {
      originWarehouseId: warehouseId,
      destinationAddress: `${runTag} destination`,
      weightKg: 100,
      ...overrides,
    });
    expect(created.status, 'the fixture create must succeed').toBe(201);
    return { id: Number(created.body.id), referenceCode: String(created.body.referenceCode) };
  }

  // AC-6 — the paged envelope, its defaults, and the paging validation.
  test('AC-6 — paged envelope with defaults, totalCount over all matches, 400 on bad paging', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);
    for (let index = 0; index < 27; index++) {
      await createRow(request, warehouseId, { destinationAddress: `${runTag} paged ${index}` });
    }

    // Defaults: page 1, pageSize 25 — and totalCount covers every match, not just the page.
    const first = await listShipments(request, adminToken, { originWarehouseId: warehouseId });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ page: 1, pageSize: 25, totalCount: 27, totalPages: 2 });
    expect(first.body.items?.length).toBe(25);

    const second = await listShipments(request, adminToken, { originWarehouseId: warehouseId, page: 2 });
    expect(second.body).toMatchObject({ page: 2, pageSize: 25, totalCount: 27, totalPages: 2 });
    expect(second.body.items?.length).toBe(2);

    // Stable paging: the two pages together hold each row exactly once (AC-8 owns the ordering rules).
    const ids = [...(first.body.items ?? []), ...(second.body.items ?? [])].map((item) => item.id);
    expect(new Set(ids).size, 'paging neither duplicates nor skips a row').toBe(27);

    // pageSize may go up to 100.
    const maxPage = await listShipments(request, adminToken, { originWarehouseId: warehouseId, pageSize: 100 });
    expect(maxPage.status).toBe(200);
    expect(maxPage.body).toMatchObject({ page: 1, pageSize: 100, totalCount: 27, totalPages: 1 });

    for (const query of [{ page: 0 }, { pageSize: 0 }, { pageSize: 101 }]) {
      const rejected = await listShipments(request, adminToken, { originWarehouseId: warehouseId, ...query });
      expect(rejected.status, `paging ${JSON.stringify(query)} must be rejected`).toBe(400);
    }
  });

  // AC-7 — filters combine with AND, q matches reference/destination, unknown enums fail loudly.
  test('AC-7 — AND filters combine, q is contains/case-insensitive, unknown enums are 400', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);
    const otherWarehouseId = await freshWarehouse(request);

    const pendingStandard = await createRow(request, warehouseId, { destinationAddress: `${runTag} AND alpha` });
    const pendingExpress = await createRow(request, warehouseId, {
      destinationAddress: `${runTag} AND beta`,
      priority: 'Express',
    });
    const otherOriginRow = await createRow(request, otherWarehouseId, { destinationAddress: `${runTag} AND gamma` });
    // A non-Pending row in the same warehouse, seeded so the status filter has something to exclude.
    const assigned = await seedShipmentAt(request, adminToken, {
      warehouseId,
      status: 'Assigned',
      slaDueAt: new Date(Date.now() + 26 * 3600_000),
    });

    const all = await listShipments(request, adminToken, { originWarehouseId: warehouseId });
    expect(all.body.totalCount).toBe(3);

    // status is an exact match.
    const pending = await listShipments(request, adminToken, { originWarehouseId: warehouseId, status: 'Pending' });
    expect(pending.body.totalCount).toBe(2);
    expect(pending.body.items?.every((item) => item.status === 'Pending')).toBe(true);
    expect(pending.body.items?.map((item) => item.id)).not.toContain(assigned.id);

    // AND: status + priority must match simultaneously.
    const combined = await listShipments(request, adminToken, {
      originWarehouseId: warehouseId,
      status: 'Pending',
      priority: 'Express',
    });
    expect(combined.body.totalCount).toBe(1);
    expect(combined.body.items?.[0]).toMatchObject({ id: pendingExpress.id, priority: 'Express' });

    // The origin filter really separates the two warehouses.
    const otherOrigin = await listShipments(request, adminToken, { originWarehouseId: otherWarehouseId });
    expect(otherOrigin.body.totalCount).toBe(1);
    expect(otherOrigin.body.items?.[0].id).toBe(otherOriginRow.id);

    // q matches the reference code (contains, case-insensitive).
    const byCode = await listShipments(request, adminToken, {
      originWarehouseId: warehouseId,
      q: pendingStandard.referenceCode.toLowerCase(),
    });
    expect(byCode.body.totalCount).toBe(1);
    expect(byCode.body.items?.[0].id).toBe(pendingStandard.id);

    // q matches the destination address (contains, case-insensitive).
    const byAddress = await listShipments(request, adminToken, {
      originWarehouseId: warehouseId,
      q: `${runTag} and beta`,
    });
    expect(byAddress.body.totalCount).toBe(1);
    expect(byAddress.body.items?.[0].id).toBe(pendingExpress.id);

    // §7: a value outside the schema enum fails loudly rather than returning a silently empty page.
    for (const query of [{ status: 'Shipped' }, { priority: 'Rocket' }]) {
      const rejected = await listShipments(request, adminToken, { originWarehouseId: warehouseId, ...query });
      expect(rejected.status, `filter ${JSON.stringify(query)} must be rejected`).toBe(400);
    }
  });

  /**
   * AC-7 (slaRisk) — the one filter value whose rejection is broken in the API today.
   *
   * Expected-failure marker carrying defect id **LOGI-0007-F1** (found by this arm, backend scope —
   * the qa boundary forbids touching `src/**`): ASP.NET's query binder throws
   * `BadHttpRequestException: Failed to bind parameter "Nullable<bool> SlaRisk"` and
   * `ExceptionHandlingMiddleware` maps it to **500**, while AC-7/§7 and the frontend MSW mirror both
   * require **400 ProblemDetails**. The same binder path means an unparsable `page` or
   * `originWarehouseId` answers 500 too, so the fix is a middleware/binder mapping, not a filter rule.
   *
   * The assertions stay strict: when the backend fix lands this test passes, Playwright then reports
   * "expected to fail, but passed" — i.e. it turns red on purpose so the marker gets removed and the
   * expectations are promoted back into the AC-7 test.
   */
  test('AC-7 — unparsable query values must answer 400 ProblemDetails, not 500', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);
    test.fail(true, 'LOGI-0007-F1: query-binder failures surface as 500 through ExceptionHandlingMiddleware');

    const observed = {
      'slaRisk=maybe': (await listShipments(request, adminToken, `?originWarehouseId=${warehouseId}&slaRisk=maybe`)).status,
      'page=abc': (await listShipments(request, adminToken, `?originWarehouseId=${warehouseId}&page=abc`)).status,
      'originWarehouseId=abc': (await listShipments(request, adminToken, '?originWarehouseId=abc')).status,
    };
    expect(observed, 'every unparsable query value must be a 400').toEqual({
      'slaRisk=maybe': 400,
      'page=abc': 400,
      'originWarehouseId=abc': 400,
    });
  });

  // AC-8 — ordering, including the SLA due date, with deterministic ties and nulls last.
  test('AC-8 — default -createdAt, slaDueAt asc/desc, id tiebreak, nulls last, unknown sort 400', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);
    const now = Date.now();
    const hours = (offset: number) => new Date(now + offset * 3600_000);
    const minutes = (offset: number) => new Date(now + offset * 60_000);

    // Pinned instants make the expected order clock-independent; the two tied rows share created_at.
    const oldest = await seedShipmentAt(request, adminToken, { warehouseId, createdAt: hours(-3), slaDueAt: null });
    const second = await seedShipmentAt(request, adminToken, { warehouseId, createdAt: hours(-2), slaDueAt: hours(-2) });
    const third = await seedShipmentAt(request, adminToken, { warehouseId, createdAt: hours(-1), slaDueAt: hours(-1) });
    const tieX = await seedShipmentAt(request, adminToken, { warehouseId, createdAt: minutes(-90), slaDueAt: hours(5) });
    const tieY = await seedShipmentAt(request, adminToken, { warehouseId, createdAt: minutes(-90), slaDueAt: hours(5) });
    const nullDue = await seedShipmentAt(request, adminToken, { warehouseId, createdAt: minutes(-100), slaDueAt: null });
    // The real endpoint's row is the newest by construction (Express ⇒ +12h, the latest due date).
    const fresh = await createRow(request, warehouseId, { destinationAddress: `${runTag} sort fresh`, priority: 'Express' });

    const ids = (body: { items?: { id: number }[] }) => (body.items ?? []).map((item) => item.id);
    const page = { originWarehouseId: warehouseId, pageSize: 100 };

    // Default sort: createdAt descending, ties by id descending.
    const byDefault = await listShipments(request, adminToken, page);
    expect(ids(byDefault.body)).toEqual([fresh.id, third.id, tieY.id, tieX.id, nullDue.id, second.id, oldest.id]);

    // createdAt ascending: ties by id ascending.
    const ascending = await listShipments(request, adminToken, { ...page, sort: 'createdAt' });
    expect(ids(ascending.body)).toEqual([oldest.id, second.id, nullDue.id, tieX.id, tieY.id, third.id, fresh.id]);

    // slaDueAt ascending / descending — nulls last in both directions, ties by id ascending.
    const dueAsc = await listShipments(request, adminToken, { ...page, sort: 'slaDueAt' });
    expect(ids(dueAsc.body).slice(0, 5)).toEqual([second.id, third.id, tieX.id, tieY.id, fresh.id]);
    expect(new Set(ids(dueAsc.body).slice(5)), 'rows without a promise sort last').toEqual(
      new Set([oldest.id, nullDue.id]),
    );

    const dueDesc = await listShipments(request, adminToken, { ...page, sort: '-slaDueAt' });
    expect(ids(dueDesc.body).slice(0, 5)).toEqual([fresh.id, tieX.id, tieY.id, third.id, second.id]);
    expect(new Set(ids(dueDesc.body).slice(5)), 'nulls stay last in both directions').toEqual(
      new Set([oldest.id, nullDue.id]),
    );

    // The tiebreak is what keeps paging stable: three pages of three rows hold each row exactly once.
    const paged: number[] = [];
    for (const pageNumber of [1, 2, 3]) {
      const chunk = await listShipments(request, adminToken, { ...page, pageSize: 3, page: pageNumber });
      expect(chunk.body).toMatchObject({ totalCount: 7, totalPages: 3 });
      paged.push(...ids(chunk.body));
    }
    expect(paged, 'paging never duplicates or skips a row').toEqual(ids(byDefault.body));
    expect(new Set(paged).size).toBe(7);

    const rejectedSort = await listShipments(request, adminToken, { ...page, sort: 'weightKg' });
    expect(rejectedSort.status, 'an unknown sort value fails loudly').toBe(400);
  });

  /**
   * AC-9 — BR-2's at-risk flag is a read-time projection (rules 2.4-2.7), never a stored column.
   *
   * The exact inclusive boundary (`now == slaDueAt - 2h`) cannot be timed over HTTP, so the rows sit
   * safely inside (90 min) and outside (26 h) the warning window; the boundary instant itself is
   * proven by the backend `SlaPolicy` unit tests. What this test proves is the projection: which
   * statuses are eligible, that a null promise is never at risk, and that `slaRisk` partitions.
   */
  test('AC-9 — atRisk is read-time: window, eligible/excluded statuses, null promise, slaRisk complement', async ({ request }) => {
    const warehouseId = await freshWarehouse(request);
    const now = Date.now();
    const at = (offsetMs: number) => new Date(now + offsetMs);

    // Inside the warning window: an upcoming due date and an already overdue one (rule 2.6).
    const soon = await seedShipmentAt(request, adminToken, { warehouseId, slaDueAt: at(90 * 60_000) });
    const overdue = await seedShipmentAt(request, adminToken, { warehouseId, slaDueAt: at(-3600_000) });
    const assignedSoon = await seedShipmentAt(request, adminToken, {
      warehouseId,
      status: 'Assigned',
      slaDueAt: at(90 * 60_000),
    });
    // Outside the window: the flag tracks the promise, not the status (rule 2.2).
    const safe = await seedShipmentAt(request, adminToken, { warehouseId, slaDueAt: at(26 * 3600_000) });
    const delayedSafe = await seedShipmentAt(request, adminToken, {
      warehouseId,
      status: 'Delayed',
      slaDueAt: at(26 * 3600_000),
    });
    // Excluded statuses are never at risk, even weeks past due (rule 2.3).
    const delivered = await seedShipmentAt(request, adminToken, {
      warehouseId,
      status: 'Delivered',
      slaDueAt: at(-3600_000),
    });
    const cancelled = await seedShipmentAt(request, adminToken, {
      warehouseId,
      status: 'Cancelled',
      slaDueAt: at(-3600_000),
    });
    // A legacy row without a promise (rule 2.7) and a real +48h API row.
    const legacy = await seedShipmentAt(request, adminToken, { warehouseId, slaDueAt: null });
    const fresh = await createRow(request, warehouseId, { destinationAddress: `${runTag} BR2 fresh` });

    const all = await listShipments(request, adminToken, { originWarehouseId: warehouseId, pageSize: 100 });
    const flags = new Map((all.body.items ?? []).map((item) => [item.id, item.atRisk]));
    expect(flags.get(soon.id), 'a due date inside the 2h window is at risk').toBe(true);
    expect(flags.get(overdue.id), 'an overdue row is still at risk (rule 2.6)').toBe(true);
    expect(flags.get(assignedSoon.id), 'Assigned is eligible (rule 2.4)').toBe(true);
    expect(flags.get(safe.id), 'well beyond the window is not at risk').toBe(false);
    expect(flags.get(delayedSafe.id), 'the window still governs an eligible status').toBe(false);
    expect(flags.get(delivered.id), 'Delivered is excluded even past due').toBe(false);
    expect(flags.get(cancelled.id), 'Cancelled is excluded even past due').toBe(false);
    expect(flags.get(legacy.id), 'no promise ⇒ not at risk (rule 2.7)').toBe(false);
    expect(flags.get(fresh.id), 'a fresh +48h row is not at risk').toBe(false);

    // Read-time: the same query returns the same projection — nothing was persisted by reading it.
    const again = await listShipments(request, adminToken, { originWarehouseId: warehouseId, pageSize: 100 });
    expect(new Map((again.body.items ?? []).map((item) => [item.id, item.atRisk]))).toEqual(flags);

    // slaRisk=true is exactly the at-risk set; slaRisk=false is exactly its complement.
    const expectedAtRisk = [...flags].filter(([, value]) => value).map(([id]) => id).sort((a, b) => a - b);
    expect(expectedAtRisk.length, 'the fixture really has at-risk rows').toBeGreaterThan(0);

    const atRisk = await listShipments(request, adminToken, {
      originWarehouseId: warehouseId,
      slaRisk: true,
      pageSize: 100,
    });
    expect(atRisk.body.totalCount).toBe(expectedAtRisk.length);
    expect((atRisk.body.items ?? []).map((item) => item.id).sort((a, b) => a - b)).toEqual(expectedAtRisk);
    expect(atRisk.body.items?.every((item) => item.atRisk)).toBe(true);

    const safeOnly = await listShipments(request, adminToken, {
      originWarehouseId: warehouseId,
      slaRisk: false,
      pageSize: 100,
    });
    expect(safeOnly.body.totalCount).toBe(flags.size - expectedAtRisk.length);
    expect(safeOnly.body.items?.every((item) => !item.atRisk)).toBe(true);
    expect(atRisk.body.totalCount + safeOnly.body.totalCount, 'the two filters partition the result set').toBe(
      flags.size,
    );
  });
});
