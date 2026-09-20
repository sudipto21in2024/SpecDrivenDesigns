import { z } from 'zod';

/** Contract enums — must match VehicleRequest in contracts/v1-openapi.yaml. */
export const vehicleTypes = ['Van', 'Truck', 'Trailer'] as const;
export const vehicleStatuses = ['Available', 'InRoute', 'Maintenance'] as const;

export type VehicleType = (typeof vehicleTypes)[number];
export type VehicleStatus = (typeof vehicleStatuses)[number];

/**
 * Vehicle form validation (LOGI-0004 AC-1…AC-6). Mirrors the backend CreateVehicleValidator
 * rules and the VehicleRequest contract so violations are caught before a request is sent.
 */
export const vehicleFormSchema = z.object({
  plateNumber: z
    .string()
    .trim()
    .min(1, 'Plate number is required')
    .max(20, 'Plate number must be at most 20 characters'),
  type: z.enum(['Van', 'Truck', 'Trailer'], { message: 'Select a valid vehicle type' }),
  // Free-text numeric input like the warehouse coordinates: validate as text so the RHF
  // defaultValues type matches, then coerce for the contract body (exclusiveMinimum 0).
  capacityKg: z
    .string()
    .trim()
    .min(1, 'Capacity must be a number')
    .refine((v) => Number.isFinite(Number(v)) && Number(v) > 0, 'Capacity must be greater than 0'),
  status: z.enum(['Available', 'InRoute', 'Maintenance']).default('Available'),
});

export type VehicleFormValues = z.infer<typeof vehicleFormSchema>;

/** Maps form values (capacity as text) to the contract request body. */
export function toVehicleInput(values: VehicleFormValues) {
  return {
    plateNumber: values.plateNumber,
    type: values.type,
    capacityKg: Number(values.capacityKg),
    status: values.status,
  };
}
