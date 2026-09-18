import { z } from 'zod';

/**
 * Client-side validation mirroring the backend FluentValidation rules for
 * WarehouseRequest (LOGI-0001) so client and server reject the same input
 * (07-coding-standards.md §Frontend).
 * Coordinates are edited as free-text fields and validated as optional ranges.
 */
const coordinate = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .refine(
      (value) => {
        if (value === '') return true;
        const parsed = Number(value);
        return !Number.isNaN(parsed) && parsed >= min && parsed <= max;
      },
      { message: `${label} must be between ${min} and ${max}` },
    );

export const warehouseFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200, 'Name must be at most 200 characters'),
  address: z.string().trim().min(1, 'Address is required').max(500, 'Address must be at most 500 characters'),
  latitude: coordinate(-90, 90, 'Latitude'),
  longitude: coordinate(-180, 180, 'Longitude'),
});

export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;

/** Maps form values (text inputs) to the contract request body (nulls for empty coords). */
export function toWarehouseInput(values: WarehouseFormValues) {
  return {
    name: values.name,
    address: values.address,
    latitude: values.latitude === '' ? null : Number(values.latitude),
    longitude: values.longitude === '' ? null : Number(values.longitude),
  };
}
