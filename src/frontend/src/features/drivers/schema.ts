import { z } from 'zod';

/** Contract enums — must match DriverRequest/DriverResponse in contracts/v1-openapi.yaml. */
export const driverStatuses = ['Active', 'OffDuty', 'Suspended'] as const;
export type DriverStatus = (typeof driverStatuses)[number];

/**
 * Client-side validation mirroring the backend FluentValidation rules for
 * DriverRequest (LOGI-0005 AC-3..AC-6) so client and server reject the same input
 * (07-coding-standards.md §Frontend). The user link is an optional positive integer;
 * an empty value clears the link on PUT (full-update semantics per the contract).
 */
export const driverFormSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Full name is required')
    .max(200, 'Full name must be at most 200 characters'),
  licenseNumber: z
    .string()
    .trim()
    .min(1, 'License number is required')
    .max(40, 'License number must be at most 40 characters'),
  phone: z
    .string()
    .trim()
    .max(40, 'Phone must be at most 40 characters')
    .optional()
    .default(''),
  status: z.enum(driverStatuses).default('Active'),
  userId: z
    .string()
    .trim()
    .refine(
      (v) => v === '' || (Number.isFinite(Number(v)) && Number(v) > 0),
      'User ID must be a positive integer',
    )
    .optional()
    .default(''),
});

export type DriverFormValues = z.infer<typeof driverFormSchema>;

/**
 * Maps form values (text inputs) to the contract request body (DriverRequest).
 * An empty user ID is omitted so PUT clears the link (null/omitted ⇒ clear per the contract).
 */
export function toDriverInput(values: DriverFormValues) {
  return {
    fullName: values.fullName,
    licenseNumber: values.licenseNumber,
    phone: values.phone || undefined,
    status: values.status,
    userId: values.userId === '' ? undefined : Number(values.userId),
  };
}
