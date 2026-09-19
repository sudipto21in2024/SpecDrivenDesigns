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
} as const;

const allRoles: readonly Role[] = ['Admin', 'Dispatcher', 'Driver', 'Viewer'];

/** Convenience wrapper so components can gate on a capability without importing each function. */
export type Capability = keyof typeof capabilities;

export function can(role: Role, capability: Capability): boolean {
  return capabilities[capability](role);
}
