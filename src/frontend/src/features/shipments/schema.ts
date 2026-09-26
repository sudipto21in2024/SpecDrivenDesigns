import { z } from 'zod';
import type { ShipmentInput, ShipmentUpdateInput } from '../../api/client';

/** Contract enums — must match ShipmentRequest.priority in contracts/v1-openapi.yaml. */
export const shipmentPriorities = ['Standard', 'Express'] as const;
export type ShipmentPriority = (typeof shipmentPriorities)[number];

export const shipmentStatusOptions = ['Pending', 'Assigned', 'InTransit', 'Delivered', 'Delayed', 'Cancelled'] as const;
export const shipmentSortOptions = ['-createdAt', 'createdAt', 'slaDueAt', '-slaDueAt'] as const;
export const slaRiskOptions = ['true', 'false', ''] as const;

/**
 * Create-shipment form validation (LOGI-0007 AC-1..AC-4). Mirrors the backend
 * CreateShipmentValidator and the ShipmentRequest contract so violations are caught before a
 * request is sent; the server still enforces them (400s mapped to fields as a backstop).
 */
export const shipmentFormSchema = z.object({
    originWarehouseId: z
    .string()
    .min(1, 'Origin warehouse is required'),
  destinationAddress: z
    .string()
    .trim()
    .min(1, 'Destination address is required')
    .max(500, 'Destination address must be at most 500 characters'),
  weightKg: z
    .string()
    .trim()
    .min(1, 'Weight is required')
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, 'Weight must be greater than 0'),
  priority: z.enum(['Standard', 'Express'], { message: 'Select a valid priority' }).default('Standard'),
  destinationLat: z
    .string()
    .optional()
    .refine((v) => (v ? !Number.isNaN(Number(v)) : true), 'Destination latitude must be a number'),
  destinationLng: z
    .string()
    .optional()
    .refine((v) => (v ? !Number.isNaN(Number(v)) : true), 'Destination longitude must be a number'),
});

export type ShipmentFormValues = z.infer<typeof shipmentFormSchema>;

/**
 * Edit-shipment form (LOGI-0008 AC-1..AC-4). Same field rules as create, except:
 *  - `priority` is absent by design — AC-4/BR-1 rule 1.5 makes it immutable, so the dialog never
 *    offers it and the mapper can never send it (the server rejects it with 400).
 *  - the origin warehouse and coordinates are optional-but-clearable, matching the nullable/optional
 *    `ShipmentUpdateRequest` shape.
 */
export const shipmentEditFormSchema = z.object({
  originWarehouseId: z.string().optional().refine((v) => v == null || v !== '', 'Origin warehouse is required'),
  destinationAddress: z
    .string()
    .trim()
    .optional()
    .refine((v) => v == null || v !== '', 'Destination address is required')
    .refine((v) => (v == null ? true : v.length <= 500), 'Destination address must be at most 500 characters'),
  weightKg: z
    .string()
    .trim()
    .optional()
    .refine((v) => v == null || v !== '', 'Weight is required')
    .refine((v) => (v == null ? true : Number.isFinite(Number(v)) && Number(v) > 0), 'Weight must be greater than 0'),
  destinationLat: z
    .string()
    .optional()
    .refine((v) => v == null || v === '' || !Number.isNaN(Number(v)), 'Destination latitude must be a number')
    .refine((v) => v == null || v === '' || (Number(v) >= -90 && Number(v) <= 90), 'Destination latitude must be between -90 and 90'),
  destinationLng: z
    .string()
    .optional()
    .refine((v) => v == null || v === '' || !Number.isNaN(Number(v)), 'Destination longitude must be a number')
    .refine((v) => v == null || v === '' || (Number(v) >= -180 && Number(v) <= 180), 'Destination longitude must be between -180 and 180'),
});

export type ShipmentEditFormValues = z.infer<typeof shipmentEditFormSchema>;

/** The editable subset of a shipment, as the edit form holds it (R5: presence is meaningful). */
export type EditableShipmentSnapshot = {
  originWarehouseId: number;
  destinationAddress: string;
  destinationLat: number | null;
  destinationLng: number | null;
  weightKg: number;
};

/**
 * Builds the PATCH body from only the fields that changed (R1). PATCH is a *partial* update, so
 * sending every field would silently clear a coordinate the user left blank; therefore:
 *  - a coordinate the user blanked is sent as an explicit `null` (an intentional clear), but only
 *    when the snapshot held a value;
 *  - a coordinate that was already null and stayed blank is omitted entirely;
 *  - every other field is sent only when its value differs from the snapshot.
 * Returns `{}` only if the user changed nothing, in which case the dialog does not send (AC-3's
 * empty-body 400 exists for API clients, not for this form).
 */
export function toShipmentUpdateInput(
  values: ShipmentEditFormValues,
  original: EditableShipmentSnapshot,
): ShipmentUpdateInput {
  const body: ShipmentUpdateInput = {};

  const originWarehouseId = values.originWarehouseId ? Number(values.originWarehouseId) : null;
  if (originWarehouseId != null && originWarehouseId !== original.originWarehouseId) {
    body.originWarehouseId = originWarehouseId;
  }

  const address = values.destinationAddress?.trim() ?? '';
  if (address !== '' && address !== original.destinationAddress) {
    body.destinationAddress = address;
  }

  const weightKg = values.weightKg != null && values.weightKg.trim() !== '' ? Number(values.weightKg) : null;
  if (weightKg != null && weightKg !== original.weightKg) {
    body.weightKg = weightKg;
  }

  // Coordinates: null when the user cleared a previously-set value, undefined when untouched.
  const lat = values.destinationLat?.trim() ?? '';
  if (lat === '') {
    if (original.destinationLat != null) body.destinationLat = null;
  } else {
    const parsed = Number(lat);
    if (parsed !== original.destinationLat) body.destinationLat = parsed;
  }

  const lng = values.destinationLng?.trim() ?? '';
  if (lng === '') {
    if (original.destinationLng != null) body.destinationLng = null;
  } else {
    const parsed = Number(lng);
    if (parsed !== original.destinationLng) body.destinationLng = parsed;
  }

  return body;
}

/** Maps validated form values to the contract request body (priority defaults to Standard via the schema). */
export function toShipmentInput(values: ShipmentFormValues): ShipmentInput {
    return {
    originWarehouseId: Number(values.originWarehouseId),
    destinationAddress: values.destinationAddress,
    destinationLat: values.destinationLat && values.destinationLat.trim()
      ? Number(values.destinationLat)
      : null,
    destinationLng: values.destinationLng && values.destinationLng.trim()
      ? Number(values.destinationLng)
      : null,
    weightKg: Number(values.weightKg),
    priority: values.priority,
  };
}
