import type {
  ListShipmentsParams,
  ShipmentPriority,
  ShipmentSort,
  ShipmentStatus,
} from '../../api/client';

/**
 * The shipment-list filters that can arrive in the URL (LOGI-0012 AC-6).
 *
 * The dashboard's drill-down builds `/shipments?status=…&routeId=…`, so the list page has to be able
 * to start from a link rather than only from its own controls. The URL is read ONCE, on mount; after
 * that the local filter state owns the value, so editing a control does not rewrite the address bar.
 */
export type ShipmentsFilterState = {
  status: ShipmentStatus | '';
  priority: ShipmentPriority | '';
  originWarehouseId: string;
  slaRisk: string;
  routeId: string;
  q: string;
  sort: ShipmentSort;
};

/** The filters this page understands from a URL. Anything else in the query string is ignored. */
export type ShipmentUrlFilters = Pick<
  ShipmentsFilterState,
  'status' | 'priority' | 'originWarehouseId' | 'slaRisk' | 'routeId' | 'q' | 'sort'
>;

/** The page's starting state when the URL carries nothing usable. */
export const EMPTY_SHIPMENT_FILTERS: ShipmentsFilterState = {
  status: '',
  priority: '',
  originWarehouseId: '',
  slaRisk: '',
  routeId: '',
  q: '',
  sort: '-createdAt',
};

const STATUSES: readonly string[] = [
  'Pending',
  'Assigned',
  'InTransit',
  'Delivered',
  'Delayed',
  'Cancelled',
];
const PRIORITIES: readonly string[] = ['Standard', 'Express'];
const SORTS: readonly string[] = ['createdAt', '-createdAt', 'slaDueAt', '-slaDueAt'];

/**
 * A positive integer, or `undefined`.
 *
 * The contract types `routeId` as integer with `minimum: 1`, and the API answers a non-positive or
 * non-integer value with a 400 this page cannot attribute to any visible control — there is no route
 * input to highlight. Dropping the value here degrades to the unfiltered list, which is the same
 * fail-quietly-at-the-edge choice the dashboard filter bar makes.
 */
function positiveInt(raw: string | null): string {
  if (raw == null || raw.trim() === '') return '';
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? String(n) : '';
}

/** One of `allowed`, or `''` — an unknown enum value is dropped rather than forwarded as a 400. */
function oneOf(raw: string | null, allowed: readonly string[]): string {
  return raw != null && allowed.includes(raw) ? raw : '';
}

/** `slaRisk` is a tri-state on the wire (absent / true / false), so an empty string stays empty. */
function triState(raw: string | null): string {
  return raw === 'true' || raw === 'false' ? raw : '';
}

/**
 * Reads the shipment-list filters out of a query string (AC-6).
 *
 * Pure and total: any input yields a valid state, because a hand-edited or stale link must degrade to
 * a usable page rather than a 400 the user cannot act on. Extracted from `ShipmentsPage` precisely so
 * this can be unit-tested without a DOM or a router.
 */
export function shipmentsFiltersFromSearch(search: string): ShipmentUrlFilters {
  const params = new URLSearchParams(search);
  return {
    status: oneOf(params.get('status'), STATUSES) as ShipmentStatus | '',
    priority: oneOf(params.get('priority'), PRIORITIES) as ShipmentPriority | '',
    originWarehouseId: positiveInt(params.get('originWarehouseId')),
    slaRisk: triState(params.get('slaRisk')),
    routeId: positiveInt(params.get('routeId')),
    q: params.get('q') ?? '',
    sort: (oneOf(params.get('sort'), SORTS) || '-createdAt') as ShipmentSort,
  };
}

/** The page's initial state, hydrated from the current `window.location.search`. */
export function initialShipmentFilters(): ShipmentsFilterState {
  const search = typeof window === 'undefined' ? '' : window.location.search;
  return { ...EMPTY_SHIPMENT_FILTERS, ...shipmentsFiltersFromSearch(search) };
}

/**
 * Projects the filter state onto the API params (AC-6).
 *
 * `routeId` is carried here, which is the whole point: before this, a route-scoped dashboard linked
 * into a list that dropped the filter on the floor.
 */
export function shipmentsParamsFromFilters(
  filters: ShipmentsFilterState,
  page: number,
  rowsPerPage: number,
): ListShipmentsParams {
  return {
    page,
    pageSize: rowsPerPage,
    status: filters.status || undefined,
    priority: filters.priority || undefined,
    originWarehouseId: filters.originWarehouseId ? Number(filters.originWarehouseId) : undefined,
    slaRisk:
      filters.slaRisk === 'true' || filters.slaRisk === 'false'
        ? filters.slaRisk === 'true'
        : undefined,
    q: filters.q || undefined,
    routeId: filters.routeId ? Number(filters.routeId) : undefined,
    sort: filters.sort,
  };
}