import { z } from 'zod';
import type { ShipmentInput } from '../../api/client';

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
