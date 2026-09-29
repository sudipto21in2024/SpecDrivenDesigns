import { z } from 'zod';
import type { Route, RouteInput, RouteUpdateInput } from '../../api/client';

/**
 * Route feature schemas and mappers (LOGI-0009).
 *
 * The planned window is entered as an RFC3339 instant (`2026-10-01T08:00:00Z`) rather than via a
 * native `datetime-local` control: the contract's `plannedStart`/`plannedEnd` are date-time
 * *instants with an explicit offset*, and a browser-local control would silently reinterpret them
 * in the operator's timezone — turning a server-side overlap guard (BR-3/BR-4) into a
 * client-timezone-dependent one. Text + strict parsing keeps the wire value exactly what the
 * dispatcher typed.
 */

/** Contract enum values for `RouteResponse.status` (order matches the contract). */
export const routeStatusOptions = ['Planned', 'InProgress', 'Completed', 'Cancelled'] as const;

/** Sentinel used by the vehicle/driver selects for "leave unassigned" (the API's explicit null). */
export const unassignedValue = '';

/** True when `value` parses as a date-time instant (Zod cannot use `Date.parse` on its own). */
function isInstant(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

/** Normalizes a user-entered instant to whole-second UTC ISO (`Kind=Utc` on the server). */
export function toInstant(value: string): string {
  return new Date(Math.floor(Date.parse(value) / 1000) * 1000).toISOString();
}

const instantMessage = 'Enter an ISO 8601 instant, e.g. 2026-10-01T08:00:00Z';
const nameField = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(200, 'Name must be at most 200 characters');
const startField = z
  .string()
  .trim()
  .min(1, 'Planned start is required')
  .refine(isInstant, instantMessage);
const endField = z.string().trim().min(1, 'Planned end is required').refine(isInstant, instantMessage);

/**
 * Create-route form (AC-1..AC-3). Mirrors the backend's CreateRouteValidator so a client-side
 * mistake never reaches the wire; the server still enforces it (400s map back onto fields).
 */
export const routeFormSchema = z
  .object({
    name: nameField,
    plannedStart: startField,
    plannedEnd: endField,
    vehicleId: z.string(),
    driverId: z.string(),
  })
  .refine(
    (values) => !isInstant(values.plannedStart) || !isInstant(values.plannedEnd) || Date.parse(values.plannedEnd) > Date.parse(values.plannedStart),
    { message: 'Planned end must be after planned start', path: ['plannedEnd'] },
  );

export type RouteFormValues = z.infer<typeof routeFormSchema>;

/**
 * Edit-route form (AC-2/AC-3): the same field rules as create. `vehicleId`/`driverId` are
 * optional-but-clearable — the mapper turns an empty selection into the explicit `null` the
 * contract uses for "unassigned", and a PATCH only carries fields that actually changed.
 */
export const routeEditFormSchema = routeFormSchema;

export type RouteEditFormValues = z.infer<typeof routeEditFormSchema>;

/**
 * The selects need a text control value for a nullable integer key, so the form holds `''`
 * (either "uninitialized" on create, or "unassigned" on edit) or a decimal id string.
 */
export function toVehicleDriverFields(route: Route | undefined): { vehicleId: string; driverId: string } {
  return {
    vehicleId: route?.vehicleId != null ? String(route.vehicleId) : unassignedValue,
    driverId: route?.driverId != null ? String(route.driverId) : unassignedValue,
  };
}

/** Maps validated create values to the contract request body (blank selects → explicit null). */
export function toRouteInput(values: RouteFormValues): RouteInput {
  return {
    name: values.name.trim(),
    plannedStart: toInstant(values.plannedStart),
    plannedEnd: toInstant(values.plannedEnd),
    vehicleId: values.vehicleId === unassignedValue ? null : Number(values.vehicleId),
    driverId: values.driverId === unassignedValue ? null : Number(values.driverId),
  };
}

/** The editable subset of a route, as the edit form holds it (presence is meaningful). */
export type EditableRouteSnapshot = {
  name: string;
  plannedStart: string;
  plannedEnd: string;
  vehicleId: number | null;
  driverId: number | null;
};

/** Captures the diff baseline from a loaded route, normalized the way the mapper compares. */
export function toRouteSnapshot(route: Route): EditableRouteSnapshot {
  return {
    name: route.name,
    plannedStart: toInstant(route.plannedStart),
    plannedEnd: toInstant(route.plannedEnd),
    vehicleId: route.vehicleId ?? null,
    driverId: route.driverId ?? null,
  };
}

/**
 * Builds the PATCH body from only the fields that changed. PATCH is a *partial* update, so
 * sending every field would silently rewrite values the user never touched; and because the
 * contract treats an explicit `null` as "unassign", a cleared select is sent as `null` only when
 * the snapshot actually held an assignment. Returns `{}` when nothing changed, in which case the
 * dialog does not send (AC-3's empty-body 400 exists for API clients, not for this form).
 */
export function toRouteUpdateInput(
  values: RouteEditFormValues,
  original: EditableRouteSnapshot,
): RouteUpdateInput {
  const body: RouteUpdateInput = {};

  const name = values.name.trim();
  if (name !== original.name) body.name = name;

  if (isInstant(values.plannedStart)) {
    const plannedStart = toInstant(values.plannedStart);
    if (plannedStart !== original.plannedStart) body.plannedStart = plannedStart;
  }

  if (isInstant(values.plannedEnd)) {
    const plannedEnd = toInstant(values.plannedEnd);
    if (plannedEnd !== original.plannedEnd) body.plannedEnd = plannedEnd;
  }

  const vehicleId = values.vehicleId === unassignedValue ? null : Number(values.vehicleId);
  if (vehicleId !== original.vehicleId) body.vehicleId = vehicleId;

  const driverId = values.driverId === unassignedValue ? null : Number(values.driverId);
  if (driverId !== original.driverId) body.driverId = driverId;

  return body;
}
