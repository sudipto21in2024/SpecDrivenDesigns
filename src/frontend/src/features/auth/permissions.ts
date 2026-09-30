import type { Role } from '../../api/client';

/**
 * Role → capability mapping for the SPA (LOGI-0003 AC-12, BR-6).
 *
 * This mirrors the `x-roles` annotations in contracts/v1-openapi.yaml. It exists so a component can
 * ask "may this user do X?" without hard-coding role lists inline, and so a single place changes if
 * the contract's role whitelist ever changes.
 *
 * IMPORTANT: this is a UX convenience only. The server is the authority (HLD §7) — hiding a button
 * is not authorization, and every one of these capabilities is enforced independently by the API. A
 * user who forges a request past the UI still receives 403.
 */
export const capabilities = {
  /** GET /warehouses, /warehouses/{id} — every authenticated role may read master data. */
  viewWarehouses: (role: Role): boolean => allRoles.includes(role),

  /** POST/PUT /warehouses — x-roles: [Admin, Dispatcher]. */
  editWarehouses: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /** DELETE /warehouses/{id} — x-roles: [Admin] only. */
  deleteWarehouses: (role: Role): boolean => role === 'Admin',

  /** GET /vehicles, /vehicles/{id} — every authenticated role may read master data. */
  viewVehicles: (role: Role): boolean => allRoles.includes(role),

  /** POST/PUT /vehicles — x-roles: [Admin, Dispatcher] (same matrix as warehouses). */
  editVehicles: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /** DELETE /vehicles/{id} — x-roles: [Admin] only. */
  deleteVehicles: (role: Role): boolean => role === 'Admin',

  /** GET /drivers, /drivers/{id} — x-roles: [Admin, Dispatcher, Viewer]; Driver excluded (master-data surface). */
  viewDrivers: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher' || role === 'Viewer',

  /** POST/PUT /drivers — x-roles: [Admin, Dispatcher]. */
  editDrivers: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /** DELETE /drivers/{id} — x-roles: [Admin] only. */
  deleteDrivers: (role: Role): boolean => role === 'Admin',

  /**
   * POST /shipments/{id}/status-transitions — x-roles: [Admin, Dispatcher, Driver] (LOGI-0006).
   * Driver ownership scoping (own-route shipments only, BR-6) is enforced from LOGI-0009/0010;
   * until then the Driver role is allowed as declared in the contract (spec §2/§7 deferral).
   */
  transitionShipments: (role: Role): boolean =>
    role === 'Admin' || role === 'Dispatcher' || role === 'Driver',

  /** GET /shipments/{id}/status-history — x-roles: [Admin, Dispatcher, Driver, Viewer] (LOGI-0006). */
  viewShipmentHistory: (role: Role): boolean => allRoles.includes(role),

  /**
   * GET /shipments — x-roles: [Admin, Dispatcher, Viewer]; Driver excluded until own-route
   * scoping lands (LOGI-0007 spec §7 deferral → LOGI-0009/0010).
   */
  viewShipments: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher' || role === 'Viewer',

  /** GET /shipments/{id} — x-roles: [Admin, Dispatcher, Viewer] (LOGI-0008 AC-7). */
  viewShipment: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher' || role === 'Viewer',

  /** PATCH /shipments/{id} — x-roles: [Admin, Dispatcher] (LOGI-0008 AC-7). */
  editShipments: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /**
   * LOGI-0008 AC-10 (BR-6): the *cancel* transition is Admin/Dispatcher-only. Deliberately separate
   * from `transitionShipments`, which stays as LOGI-0006 declared it — a Driver may still perform a
   * non-terminal transition (e.g. Assigned → InTransit) and is only barred from cancelling.
   */
  cancelShipments: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /** POST /shipments — x-roles: [Admin, Dispatcher] (LOGI-0007 AC-10). */
  createShipments: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /** GET /routes, /routes/{id} — x-roles: [Admin, Dispatcher, Viewer, Driver] (LOGI-0009). */
  viewRoutes: (role: Role): boolean => allRoles.includes(role),

  /** POST /routes — x-roles: [Admin, Dispatcher] (LOGI-0009). */
  createRoutes: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /** PATCH /routes/{id} — x-roles: [Admin, Dispatcher] (LOGI-0009). */
  editRoutes: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',

  /**
   * GET /routes/{id}/shipments — x-roles: [Admin, Dispatcher, Viewer, Driver] (LOGI-0010 AC-7).
   * A Driver's read is additionally row-scoped to their own route server-side (BR-6); the role
   * whitelist here can only express "may open the panel at all".
   */
  viewRouteShipments: (role: Role): boolean => allRoles.includes(role),

  /**
   * POST /routes/{id}/shipments and DELETE /routes/{id}/shipments/{shipmentId} — x-roles:
   * [Admin, Dispatcher] (LOGI-0010 AC-7). One capability for both, because assign and unassign
   * are the same operator action on the same panel.
   */
  assignRouteShipments: (role: Role): boolean => role === 'Admin' || role === 'Dispatcher',
} as const;

const allRoles: readonly Role[] = ['Admin', 'Dispatcher', 'Driver', 'Viewer'];

/** Convenience wrapper so components can gate on a capability without importing each function. */
export type Capability = keyof typeof capabilities;

export function can(role: Role, capability: Capability): boolean {
  return capabilities[capability](role);
}
