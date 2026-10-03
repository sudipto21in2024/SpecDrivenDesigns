import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_SHIPMENT_FILTERS,
  initialShipmentFilters,
  shipmentsFiltersFromSearch,
  shipmentsParamsFromFilters,
} from './shipmentsFilterParams';

/**
 * LOGI-0012 AC-6: the shipment list must start from a deep link, because the dashboard's drill-down
 * is a link. `shipmentListHref` emits `/shipments?status=…&routeId=…`, so these cases pin the parser
 * that turns that query string into the filter state — and, just as importantly, pin that junk in a
 * hand-edited URL degrades to the unfiltered list instead of a 400 the page cannot attribute to any
 * control (there is no route input on this page to highlight).
 */
describe('shipmentsFiltersFromSearch (LOGI-0012 AC-6)', () => {
  // LOGI-0012 AC-6
  it('reads the route-scoped drill-down the dashboard emits', () => {
    // LOGI-0012 AC-6
    expect(shipmentsFiltersFromSearch('?status=InTransit&routeId=7')).toEqual({
      status: 'InTransit',
      priority: '',
      originWarehouseId: '',
      slaRisk: '',
      routeId: '7',
      q: '',
      sort: '-createdAt',
    });
  });

  // LOGI-0012 AC-6
  it('reads the at-risk drill-down target', () => {
    // LOGI-0012 AC-6
    expect(shipmentsFiltersFromSearch('?slaRisk=true').slaRisk).toBe('true');
    expect(shipmentsFiltersFromSearch('?slaRisk=false').slaRisk).toBe('false');
  });

  // LOGI-0012 AC-6
  it('falls back to the contract default sort when none is given', () => {
    // LOGI-0012 AC-6
    expect(shipmentsFiltersFromSearch('?routeId=7').sort).toBe('-createdAt');
    expect(shipmentsFiltersFromSearch('?sort=slaDueAt').sort).toBe('slaDueAt');
  });

  // LOGI-0012 AC-6
  it('drops a non-positive or non-integer routeId rather than forwarding a 400', () => {
    // LOGI-0012 AC-6: the contract is integer/int64 minimum 1. Sending 0, -1 or "abc" would earn a
    // keyed 400 on a page with no route control to attach it to, so the filter is dropped instead.
    for (const bad of ['0', '-1', 'abc', '1.5', '', '  ']) {
      expect(shipmentsFiltersFromSearch(`?routeId=${encodeURIComponent(bad)}`).routeId).toBe('');
    }
  });

  // LOGI-0012 AC-6
  it('drops an unknown status, priority or sort enum', () => {
    // LOGI-0012 AC-6
    expect(shipmentsFiltersFromSearch('?status=Flying').status).toBe('');
    expect(shipmentsFiltersFromSearch('?priority=Overnight').priority).toBe('');
    expect(shipmentsFiltersFromSearch('?sort=weightKg').sort).toBe('-createdAt');
  });

  // LOGI-0012 AC-6
  it('reads an empty query string as no filters at all', () => {
    // LOGI-0012 AC-6
    expect(shipmentsFiltersFromSearch('')).toEqual({
      status: '',
      priority: '',
      originWarehouseId: '',
      slaRisk: '',
      routeId: '',
      q: '',
      sort: '-createdAt',
    });
  });
});

describe('shipmentsParamsFromFilters (LOGI-0012 AC-6)', () => {
  // LOGI-0012 AC-6
  it('carries routeId into the API params — the link that makes the drill-down lossless', () => {
    // LOGI-0012 AC-6
    const params = shipmentsParamsFromFilters({ ...EMPTY_SHIPMENT_FILTERS, routeId: '7' }, 1, 25);
    expect(params.routeId).toBe(7);
  });

  // LOGI-0012 AC-6
  it('omits every unset filter so the contract defaults apply', () => {
    // LOGI-0012 AC-6
    const params = shipmentsParamsFromFilters(EMPTY_SHIPMENT_FILTERS, 1, 25);
    expect(params.routeId).toBeUndefined();
    expect(params.status).toBeUndefined();
    expect(params.originWarehouseId).toBeUndefined();
    expect(params.slaRisk).toBeUndefined();
    expect(params.q).toBeUndefined();
    expect(params.page).toBe(1);
    expect(params.pageSize).toBe(25);
  });
});

describe('initialShipmentFilters (LOGI-0012 AC-6)', () => {
  // LOGI-0012 AC-6
  it('defaults to the empty filter set when the window carries no query string', () => {
    // LOGI-0012 AC-6
    expect(initialShipmentFilters()).toEqual(EMPTY_SHIPMENT_FILTERS);
  });

  // LOGI-0012 AC-6
  it('hydrates routeId from window.location so a drill-down link starts filtered', () => {
    // LOGI-0012 AC-6: the seed of a route-scoped list. Hydrating on the FIRST render is what stops an
    // unfiltered read being issued first — `useShipments` keys its query on the params it is given.
    const spy = vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      search: '?status=InTransit&routeId=7',
    } as Location);

    expect(initialShipmentFilters().routeId).toBe('7');
    expect(initialShipmentFilters().status).toBe('InTransit');

    spy.mockRestore();
  });
});