import type {
  DashboardAtRiskShipment,
  DashboardResponse,
  DriverUtilization,
  GetDashboardParams,
  ShipmentPriority,
  ShipmentStatus,
  VehicleUtilization,
} from '../../api/client';

/**
 * Operations-dashboard view model helpers (LOGI-0012).
 *
 * Everything here is PRESENTATION over ONE response. The dashboard never recomputes a count, re-derives
 * "at risk", or sums a bucket: the server evaluated all of it at a single captured instant and exposed
 * it as `generatedAt` (AC-3). A helper here that recomputed a number would be a second source of truth,
 * which is the exact failure mode the single-request design exists to prevent.
 */

/** The six BR-7 statuses in lifecycle order — the tile row's order (AC-1). */
export const DASHBOARD_STATUSES: readonly ShipmentStatus[] = [
  'Pending',
  'Assigned',
  'InTransit',
  'Delivered',
  'Delayed',
  'Cancelled',
];

/** Contract default for the at-risk page (AC-8): 20 rows unless `pageSize` says otherwise. */
export const DEFAULT_AT_RISK_PAGE_SIZE = 20;

/** Contract ceiling for `pageSize`; the pager must never ask for more than this. */
export const MAX_PAGE_SIZE = 100;

/** The priority values the filter bar offers (AC-6 — the same enum the shipments list filters on). */
export const DASHBOARD_PRIORITY_OPTIONS: readonly ShipmentPriority[] = ['Standard', 'Express'];

/** The filter bar's state. Every field is optional; `undefined` means "not supplied" (AC-6). */
export type DashboardFilterState = Omit<GetDashboardParams, 'page' | 'pageSize'>;

export const EMPTY_DASHBOARD_FILTERS: DashboardFilterState = {};

/**
 * Orders the tiles into the lifecycle regardless of the sequence the server sent them (AC-1).
 *
 * The API already returns all six in order; this is a guard, not a whitelist, so a future contract
 * change cannot silently reshuffle a manager's mental model of the pipeline.
 */
export function orderStatusCounts(dashboard: DashboardResponse) {
  return [...dashboard.statusCounts].sort(
    (a, b) => DASHBOARD_STATUSES.indexOf(a.status) - DASHBOARD_STATUSES.indexOf(b.status),
  );
}

/**
 * The count for one status, or 0 when the response omitted it (AC-1).
 *
 * Zero-filling exists so a missing tile reads "0" rather than "undefined"; the API always sends all
 * six, so this is a rendering safety net, not a way of inventing data.
 */
export function countForStatus(dashboard: DashboardResponse, status: ShipmentStatus): number {
  return dashboard.statusCounts.find((entry) => entry.status === status)?.count ?? 0;
}

/**
 * AC-3: the at-risk tile's number and the pager's number are the SAME number by construction.
 *
 * Returning one of them for both is deliberate. If the UI ever rendered `atRiskShipments.items.length`
 * as a count it would silently show the page size instead of the total, which is the bug this helper
 * exists to make impossible.
 */
export function atRiskTotal(dashboard: DashboardResponse): number {
  return dashboard.atRiskTotalCount;
}

/** True when at least one filter is set, so the UI can offer a "clear filters" affordance. */
export function hasActiveFilters(filters: DashboardFilterState): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== null);
}

/**
 * Formats a utilization percentage, where the API's null is meaningful (AC-4/AC-5).
 *
 * `utilizationPercent` is null when the denominator is 0 — an empty fleet means "no capacity", NOT
 * "0% used". Rendering that null as "0%" would state something the data contradicts, so it becomes an
 * em dash carrying a title that explains why.
 */
export function formatUtilizationPercent(percent: number | null): string {
  if (percent == null) return '—';
  const rounded = Math.round(percent * 100) / 100;
  return `${rounded}%`;
}

/** True when the API reported "no capacity", which the panels label rather than showing as 0%. */
export function hasNoCapacity(utilization: VehicleUtilization | DriverUtilization): boolean {
  return utilization.utilizationPercent == null;
}

/**
 * The bucket counts for a utilization panel, in the resource's own status order (AC-4/AC-5, O3).
 *
 * `byStatus` already includes empty buckets with 0, so every enum member is rendered — the same
 * "never invent a missing tile" rule the status tiles follow. The order is supplied by the caller
 * because the vehicle and driver enums are different sets, and inventing a second literal here is
 * how a schema change would silently desync the panels.
 */
export function utilizationBuckets(
  utilization: VehicleUtilization | DriverUtilization,
  order: readonly string[],
): { status: string; count: number }[] {
  const byStatus = utilization.byStatus ?? {};
  return order.map((status) => ({ status, count: byStatus[status] ?? 0 }));
}

/** The contract's vehicle status enum, in lifecycle order (AC-4, O3). */
export const VEHICLE_STATUS_ORDER = ['Available', 'InRoute', 'Maintenance'] as const;

/** The contract's driver status enum, in lifecycle order (AC-5, O3). */
export const DRIVER_STATUS_ORDER = ['Active', 'OffDuty', 'Suspended'] as const;

/**
 * The drill-down target for a status tile (AC-6).
 *
 * Always an EXISTING endpoint with the equivalent filter — `GET /shipments?status=…` — so following a
 * tile shows exactly the rows it counted. A dashboard-only results route would be a second query
 * language and is precisely what AC-6 forbids.
 */
export function shipmentListHref(
  status: ShipmentStatus | 'at-risk',
  filters: DashboardFilterState = {},
): string {
  const query = new URLSearchParams();
  if (status === 'at-risk') {
    query.set('slaRisk', 'true');
  } else {
    query.set('status', status);
  }
  // The dashboard's own priority/warehouse/route filters carry over, so the drill-down shows the slice
  // the tile counted rather than the whole org (AC-6). A status filter is NOT carried when the tile
  // already set one: the tile's own status is the question being asked.
  if (filters.priority != null) query.set('priority', filters.priority);
  if (filters.originWarehouseId != null) {
    query.set('originWarehouseId', String(filters.originWarehouseId));
  }
  if (filters.routeId != null) query.set('routeId', String(filters.routeId));
  return `/shipments?${query.toString()}`;
}

/** The drill-down target for a vehicle bucket (AC-6): `GET /vehicles?status=…`. */
export function vehicleListHref(status: string): string {
  return `/vehicles?status=${encodeURIComponent(status)}`;
}

/** The drill-down target for a driver bucket (AC-6): `GET /drivers?status=…`. */
export function driverListHref(status: string): string {
  return `/drivers?status=${encodeURIComponent(status)}`;
}

/**
 * The next page to request, or null when there is nothing further to fetch (AC-2).
 *
 * Returns null rather than the current page so the pager's "next" button disappears instead of issuing
 * a read that cannot change what is on screen.
 */
export function nextAtRiskPage(dashboard: DashboardResponse): number | null {
  const { page, totalPages } = dashboard.atRiskShipments;
  return page < totalPages ? page + 1 : null;
}

/** The previous page, or null on the first one (AC-2). */
export function previousAtRiskPage(dashboard: DashboardResponse): number | null {
  return dashboard.atRiskShipments.page > 1 ? dashboard.atRiskShipments.page - 1 : null;
}

/**
 * Formats `minutesToDue` for the at-risk row (AC-2).
 *
 * Negative means overdue, which the row emphasises; null means no promise was recorded — rendered as an
 * em dash rather than "0 minutes", because "0 minutes to due" would assert a deadline that does not exist.
 */
export function formatMinutesToDue(minutes: number | null): string {
  if (minutes == null) return '—';
  if (minutes < 0) return `${Math.abs(minutes)} min overdue`;
  if (minutes === 0) return 'due now';
  return `${minutes} min`;
}

/** AC-2: a row is overdue when its due moment has already passed at the captured instant. */
export function isOverdue(row: DashboardAtRiskShipment): boolean {
  return row.minutesToDue != null && row.minutesToDue < 0;
}