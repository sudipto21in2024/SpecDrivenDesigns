import { expect, test, type APIRequestContext } from '@playwright/test';
import type { ShipmentStatus } from '../../src/frontend/src/api/client';
import { seedVehicle, seedWarehouse, signIn } from './support/api';
import { seedRoute, uniqueRef } from './support/routes';
import { driverScopedWindow, listRouteShipments } from './support/route-shipments';
import { getShipment, listShipments } from './support/shipments';
import {
  BOARD_STATUSES,
  boardTag,
  columnOf,
  flattenBoardCards,
  getPlanningBoard,
  routeCardOf,
  seedBoardShipment,
} from './support/planning-board';

/**
 * LOGI-0011 `GET /api/v1/planning-board` against the real API, real JWTs and the throwaway SQLite
 * database (AC-1..AC-5, AC-8, AC-9).
 *
 * Every assertion is scoped by a filter the fixture owns — `routeId` or the per-run `q` tag — because
 * the board is an org-wide projection: an unfiltered assertion would also be asserting on the rows
 * every other spec seeded. Where an unfiltered count *must* be asserted (AC-1's column set, AC-5's
 * unassigned lane, AC-9's determinism), the assertion is a comparison or a delta, never a literal.
 */
test.describe('LOGI-0011 planning board (API)', () => {
  let adminToken: string;
  let warehouseId: number;

  test.beforeEach(async ({ request }) => {
    adminToken = (await signIn(request, 'Admin')).accessToken;
    warehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('PB')}`);
  });

  /** A Planned route on its own window band, so it never overlaps another spec's route. */
  async function seedBoardRoute(vehicleId: number | null = null, status = 'Planned'): Promise<number> {
    return (await seedRoute({
      status: status as 'Planned',
      vehicleId,
      plannedStart: driverScopedWindow(1_500_000),
      plannedEnd: driverScopedWindow(1_500_480),
    })).id;
  }

  // LOGI-0011 AC-1
  test('AC-1 — six columns in the fixed BR-7 order, never omitted, each card in exactly one // LOGI-0011 AC-1', async ({
    request,
  }) => {
    const routeId = await seedBoardRoute();

    // One card per status, so every column has a body and no column can be omitted by accident.
    const seeded = [];
    for (const status of BOARD_STATUSES) {
      seeded.push(
        await seedBoardShipment({
          warehouseId,
          status,
          // Every card is linked, so this test's board filter (routeId) owns all of them and cannot
          // also pick up another spec's rows. The unassigned lane is AC-5's own scenario.
          routeId,
          // Pinned, staggered due dates so the within-column order is deterministic (AC-9).
          slaDueAt: new Date(Date.UTC(2026, 9, 1 + BOARD_STATUSES.indexOf(status), 8)),
        }),
      );
    }

    const board = await getPlanningBoard(request, adminToken, { routeId });
    expect(board.status).toBe(200);

    // The six statuses in the fixed lifecycle order, always.
    expect(board.body.columns?.map((column) => column.status)).toEqual([...BOARD_STATUSES]);

    // A status with no shipments is present with 0 and an empty array — here every column has one.
    for (const status of BOARD_STATUSES) {
      const column = columnOf(board.body, status);
      expect(column.totalCount).toBe(1);
      expect(column.truncated).toBe(false);
      expect(column.cards).toHaveLength(1);
    }

    // Every card sits in the column matching its OWN status, and no id appears in two columns.
    const ids = flattenBoardCards(board.body).map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of seeded) {
      const cards = flattenBoardCards(board.body).filter((card) => card.id === row.id);
      expect(cards, 'every seeded card must be on the board').toHaveLength(1);
      expect(cards[0].status).toBe(row.status);
    }

    // An empty status is still rendered as a column — proved by a filter that matches nothing.
    const empty = await getPlanningBoard(request, adminToken, { q: 'SHP-ZZZ-no-such-shipment' });
    expect(empty.status).toBe(200);
    expect(empty.body.columns?.map((column) => column.status)).toEqual([...BOARD_STATUSES]);
    for (const column of empty.body.columns ?? []) {
      expect(column.totalCount).toBe(0);
      expect(column.truncated).toBe(false);
      expect(column.cards).toEqual([]);
    }
  });

  // LOGI-0011 AC-2
  test('AC-2 — the flat list is the same cards, default-ordered by slaDueAt ascending // LOGI-0011 AC-2', async ({
    request,
  }) => {
    const routeId = await seedBoardRoute();
    // Same status (one column, so the list order is the card order) with deliberately shuffled due
    // dates: seed b before a, so the assertion fails if the sort is not actually applied.
    const b = await seedBoardShipment({
      warehouseId,
      status: 'Pending',
      routeId,
      slaDueAt: new Date(Date.UTC(2026, 9, 3, 8)),
    });
    const a = await seedBoardShipment({
      warehouseId,
      status: 'Pending',
      routeId,
      slaDueAt: new Date(Date.UTC(2026, 9, 2, 8)),
    });
    // Both share one due instant, so the createdAt assertions below cannot be satisfied by accident
    // through the slaDueAt default order.
    const dueAt = new Date(Date.UTC(2026, 9, 4, 8));

    const board = await getPlanningBoard(request, adminToken, { routeId, status: 'Pending' });
    expect(board.status).toBe(200);

    // The "list view" of AC-2 is the flattening of the one response, so the two agree card-for-card.
    const list = flattenBoardCards(board.body);
    expect(list.map((card) => card.id)).toEqual([a.id, b.id]);
    expect(new Set(list.map((card) => card.id))).toEqual(new Set([a.id, b.id]));

    // createdAt descending is selectable and reverses the two — pinned instants, so this does not
    // depend on two INSERTs landing in different clock ticks.
    const earliest = new Date(Date.UTC(2026, 9, 1, 6));
    const latest = new Date(Date.UTC(2026, 9, 1, 7));
    const late = await seedBoardShipment({
      warehouseId,
      status: 'Pending',
      routeId,
      slaDueAt: dueAt,
      createdAt: latest,
    });
    const early = await seedBoardShipment({
      warehouseId,
      status: 'Pending',
      routeId,
      slaDueAt: dueAt,
      createdAt: earliest,
    });

    const desc = await getPlanningBoard(request, adminToken, {
      routeId,
      status: 'Pending',
      sort: '-createdAt',
      maxPerColumn: 200,
    });
    const descIds = flattenBoardCards(desc.body).map((card) => card.id);
    expect(descIds.indexOf(late.id), '-createdAt puts the newer row first').toBeLessThan(
      descIds.indexOf(early.id),
    );

    const asc = await getPlanningBoard(request, adminToken, {
      routeId,
      status: 'Pending',
      sort: 'createdAt',
      maxPerColumn: 200,
    });
    const ascIds = flattenBoardCards(asc.body).map((card) => card.id);
    expect(ascIds.indexOf(early.id), 'createdAt puts the older row first').toBeLessThan(
      ascIds.indexOf(late.id),
    );

    // Four cards now share this route+status, so the board/list comparison is over all of them.
    const viaShipments = await listShipments(request, adminToken, { status: 'Pending', pageSize: 100 });
    expect(viaShipments.status).toBe(200);
    const listIds = (viaShipments.body.items ?? [])
      .filter((item) => item.routeId === routeId)
      .map((item) => item.id);
    expect(new Set(listIds)).toEqual(new Set([a.id, b.id, late.id, early.id]));
  });

  // LOGI-0011 AC-3
  test('AC-3 — filters AND-compose and the applied set is echoed with nulls // LOGI-0011 AC-3', async ({
    request,
  }) => {
    const routeId = await seedBoardRoute();
    const otherWarehouseId = await seedWarehouse(request, adminToken, `QA WH ${uniqueRef('PB3')}`);
    // BR-2 rule 2.2: a due date 30 minutes out is inside the at-risk window; one a fortnight out is not.
    const dueSoon = new Date(Date.now() + 30 * 60_000);
    const dueLater = new Date(Date.now() + 14 * 24 * 60 * 60_000);

    // Four cards that differ in exactly one filter each; only `match` satisfies all five at once.
    const match = await seedBoardShipment({
      warehouseId,
      status: 'Pending',
      priority: 'Express',
      routeId,
      slaDueAt: dueSoon, // inside the BR-2 window -> atRisk
    });
    await seedBoardShipment({ warehouseId, status: 'Assigned', priority: 'Express', routeId, slaDueAt: dueSoon });
    await seedBoardShipment({ warehouseId, status: 'Pending', priority: 'Express', routeId, slaDueAt: dueLater });
    await seedBoardShipment({ warehouseId: otherWarehouseId, status: 'Pending', priority: 'Express', routeId, slaDueAt: dueSoon });

    const board = await getPlanningBoard(request, adminToken, {
      status: 'Pending',
      priority: 'Express',
      originWarehouseId: warehouseId,
      slaRisk: true,
      routeId,
      q: match.referenceCode,
    });
    expect(board.status).toBe(200);

    // Only the card matching every supplied filter comes back, in both views.
    expect(flattenBoardCards(board.body).map((card) => card.id)).toEqual([match.id]);
    expect(columnOf(board.body, 'Assigned').totalCount).toBe(0);

    // The echo carries exactly what was applied; the defaults for the rest are null, never omitted.
    expect(board.body.appliedFilters).toMatchObject({
      status: 'Pending',
      priority: 'Express',
      originWarehouseId: warehouseId,
      slaRisk: true,
      routeId,
      q: match.referenceCode,
      sort: 'slaDueAt',
      maxPerColumn: 50,
    });

    // An unsupplied filter is echoed as null, so the client never has to distinguish "unset" from
    // "not returned" (contract BoardFilters).
    const partial = await getPlanningBoard(request, adminToken, { status: 'Pending' });
    expect(partial.status).toBe(200);
    expect(partial.body.appliedFilters?.priority).toBeNull();
    expect(partial.body.appliedFilters?.originWarehouseId).toBeNull();
    expect(partial.body.appliedFilters?.slaRisk).toBeNull();
    expect(partial.body.appliedFilters?.routeId).toBeNull();
    expect(partial.body.appliedFilters?.q).toBeNull();
  });

  // LOGI-0011 AC-4
  test('AC-4 — the route capacity bar is the BR-5 projection, and null (not 0) with no vehicle // LOGI-0011 AC-4', async ({
    request,
  }) => {
    const vehicleId = await seedVehicle(request, adminToken, uniqueRef('PBCAP'), { capacityKg: 1000 });
    const routeId = await seedBoardRoute(vehicleId);
    await seedBoardShipment({ warehouseId, status: 'Assigned', routeId, weightKg: 700 });

    const board = await getPlanningBoard(request, adminToken, { routeId });
    expect(board.status).toBe(200);

    const card = routeCardOf(board.body, routeId);
    expect(card.vehicleId).toBe(vehicleId);
    expect(card.capacity).toMatchObject({
      vehicleId,
      capacityKg: 1000,
      assignedWeightKg: 700,
      remainingCapacityKg: 300,
      shipmentCount: 1,
    });

    // O4: the single source is GET /routes/{id}/shipments, so the two must be numerically identical.
    const viaRoute = await listRouteShipments(request, adminToken, routeId, { pageSize: 100 });
    expect(viaRoute.status).toBe(200);
    expect(card.capacity).toEqual(viaRoute.body.capacity);

    // A route with no vehicle reports null — never 0, which would read as "full".
    const vehicleLessId = await seedBoardRoute(null);
    await seedBoardShipment({ warehouseId, status: 'Assigned', routeId: vehicleLessId, weightKg: 400 });
    const vehicleLess = await getPlanningBoard(request, adminToken, { routeId: vehicleLessId });
    const noVehicle = routeCardOf(vehicleLess.body, vehicleLessId);
    expect(noVehicle.vehicleId).toBeNull();
    expect(noVehicle.capacity?.vehicleId).toBeNull();
    expect(noVehicle.capacity?.capacityKg).toBeNull();
    expect(noVehicle.capacity?.remainingCapacityKg).toBeNull();
    // The shipment count still projects, so the card is not blank — only the capacity is unknown.
    expect(noVehicle.capacity?.assignedWeightKg).toBe(400);
  });

  // LOGI-0011 AC-5
  test('AC-5 — the unassigned lane is a count, and routeId does not imply routeId=null // LOGI-0011 AC-5', async ({
    request,
  }) => {
    const routeId = await seedBoardRoute();
    const unassigned = await seedBoardShipment({
      warehouseId,
      status: 'Pending',
      routeId: null,
      destinationAddress: `Board lane ${boardTag()}`,
    });
    const assigned = await seedBoardShipment({
      warehouseId,
      status: 'Assigned',
      routeId,
      destinationAddress: `Board lane ${boardTag()}`,
    });

    // With no filters the Pending shipment with a null route is on the board and counted.
    const all = await getPlanningBoard(request, adminToken, {
      q: `Board lane ${boardTag()}`,
      maxPerColumn: 200,
    });
    expect(all.status).toBe(200);
    expect(columnOf(all.body, 'Pending').cards.map((card) => card.id)).toEqual([unassigned.id]);
    expect(all.body.unassignedTotalCount).toBe(1);

    // Filtering by routeId does NOT hide the unassigned row's *lane count* semantics: routeId is a
    // filter, not an implicit equality on null. So the narrowed board holds only the linked card and
    // reports zero unassigned — the lane follows the filters instead of contradicting them.
    const narrowed = await getPlanningBoard(request, adminToken, { routeId, q: `Board lane ${boardTag()}` });
    expect(narrowed.status).toBe(200);
    expect(flattenBoardCards(narrowed.body).map((card) => card.id)).toEqual([assigned.id]);
    expect(narrowed.body.unassignedTotalCount).toBe(0);

    // No synthetic "unassigned route" row is invented: the lane is a count, not a route card.
    expect((narrowed.body.routes ?? []).some((route) => route.name.toLowerCase().includes('unassigned'))).toBe(
      false,
    );
  });

  // LOGI-0011 AC-8
  test('AC-8 — out-of-range and unknown parameters 400 with keyed errors // LOGI-0011 AC-8', async ({
    request,
  }) => {
    const routeId = await seedBoardRoute();
    const before = await getPlanningBoard(request, adminToken, { routeId });
    expect(before.status).toBe(200);

    const invalid: Record<string, string> = {
      'maxPerColumn=0': 'maxPerColumn',
      'maxPerColumn=201': 'maxPerColumn',
      'status=Bogus': 'status',
      'priority=Urgent': 'priority',
      'sort=nonsense': 'sort',
      'routeId=0': 'routeId',
      'originWarehouseId=0': 'originWarehouseId',
    };

    for (const [query, key] of Object.entries(invalid)) {
      const rejected = await getPlanningBoard(request, adminToken, query);
      expect(rejected.status, `${query} must be rejected with 400`).toBe(400);
      const errors = rejected.body.errors ?? {};
      expect(Object.keys(errors), `${query} must name ${key}`).toContain(key);
    }

    // The board holds no state: the very same board still reads identically.
    const after = await getPlanningBoard(request, adminToken, { routeId });
    expect(after.status).toBe(200);
    expect(after.body.columns).toEqual(before.body.columns);
  });

  // LOGI-0011 AC-8
  test.describe.serial('AC-8 — maxPerColumn truncates a column while totalCount stays whole', () => {
    // One column, seeded once: 312 rows is 312 INSERTs, so it is owned by a single serial block
    // rather than re-seeded per test.
    const TRUNCATION_ROWS = 312;

    test('AC-8 — 50 cards of 312 with truncated=true and the untruncated totalCount // LOGI-0011 AC-8', async ({
      request,
    }) => {
      const vehicleId = await seedVehicle(request, adminToken, uniqueRef('PBT'), { capacityKg: 1000 });
      const routeId = await seedBoardRoute(vehicleId);
      for (let index = 0; index < TRUNCATION_ROWS; index += 1) {
        await seedBoardShipment({
          warehouseId,
          status: 'Delayed',
          routeId,
          weightKg: 10,
          slaDueAt: new Date(Date.UTC(2026, 9, 2, 8, 0, index % 60)),
        });
      }

      const board = await getPlanningBoard(request, adminToken, {
        routeId,
        status: 'Delayed',
        maxPerColumn: 50,
      });
      expect(board.status).toBe(200);

      const column = columnOf(board.body, 'Delayed');
      expect(column.totalCount).toBe(TRUNCATION_ROWS);
      expect(column.truncated).toBe(true);
      expect(column.cards).toHaveLength(50);
      // Truncation must not duplicate: 50 unique ids.
      expect(new Set(column.cards.map((card) => card.id)).size).toBe(50);

      // The cap is honoured at its own bound too, and the flag is computed from the real cut: at
      // maxPerColumn=200 the column returns 200 of 312 and is still (correctly) truncated, because
      // 312 > 200 — not because the server forgot to un-truncate a column it fully returned.
      const capped = await getPlanningBoard(request, adminToken, {
        routeId,
        status: 'Delayed',
        maxPerColumn: 200,
      });
      const cappedColumn = columnOf(capped.body, 'Delayed');
      expect(cappedColumn.totalCount).toBe(TRUNCATION_ROWS);
      expect(cappedColumn.truncated).toBe(true);
      expect(cappedColumn.cards).toHaveLength(200);

      // A cap below the row count still truncates, and the flag tracks the number actually returned.
      const whole = await getPlanningBoard(request, adminToken, {
        routeId,
        status: 'Delayed',
        maxPerColumn: 1,
      });
      expect(columnOf(whole.body, 'Delayed').truncated).toBe(true);
      expect(columnOf(whole.body, 'Delayed').cards).toHaveLength(1);

      const other = await getPlanningBoard(request, adminToken, {
        routeId,
        status: 'Cancelled',
        maxPerColumn: 50,
      });
      expect(columnOf(other.body, 'Cancelled')).toMatchObject({
        totalCount: 0,
        truncated: false,
        cards: [],
      });
    });
  });

  // LOGI-0011 AC-9
  test('AC-9 — two identical requests are stable, id-tiebroken, and agree with GET /shipments // LOGI-0011 AC-9', async ({
    request,
  }) => {
    const routeId = await seedBoardRoute();
    // Three cards sharing one due instant: the id tiebreak is the only thing that can order them.
    const dueAt = new Date(Date.UTC(2026, 9, 9, 8));
    const createdAt = new Date(Date.UTC(2026, 9, 1, 6));
    const tied = [];
    for (let index = 0; index < 3; index += 1) {
      tied.push(
        await seedBoardShipment({ warehouseId, status: 'InTransit', routeId, slaDueAt: dueAt, createdAt }),
      );
    }

    const first = await getPlanningBoard(request, adminToken, { routeId, maxPerColumn: 200 });
    const second = await getPlanningBoard(request, adminToken, { routeId, maxPerColumn: 200 });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);

    // Column order and, within a column, card order are identical across the two requests.
    expect(second.body.columns?.map((column) => column.status)).toEqual(
      first.body.columns?.map((column) => column.status),
    );
    const firstCards = flattenBoardCards(first.body).map((card) => card.id);
    expect(flattenBoardCards(second.body).map((card) => card.id)).toEqual(firstCards);

    // Default order is slaDueAt ascending with id ascending as the tiebreak, so the equal due dates
    // come back in id order and never reorder.
    expect(firstCards).toEqual(tied.map((row) => row.id).sort((a, b) => a - b));
    expect(new Set(firstCards).size).toBe(firstCards.length);

    // Every card agrees with the LOGI-0007 read model at the same instant: status, routeId, atRisk.
    for (const card of flattenBoardCards(first.body)) {
      const detail = await getShipment(request, adminToken, card.id);
      expect(detail.status).toBe(200);
      expect(card.status).toBe(detail.body.status);
      expect(card.routeId).toBe(detail.body.routeId);
      expect(card.atRisk).toBe(detail.body.atRisk);
      expect(card.referenceCode).toBe(detail.body.referenceCode);
    }
  });
});
