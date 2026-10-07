# 08 — Forms & Validation (react-hook-form + Zod)

Every write surface in LogiFlow is a dialog with a form. The pattern is identical everywhere, so
learn it once on `WarehouseFormDialog` and you can read them all.

## 1. The three pieces

```text
schema.ts          → WHAT is valid   (Zod schema mirroring the backend's FluentValidation rules)
FormDialog.tsx     → HOW it's collected (react-hook-form + MUI TextField) and submitted
Page.tsx           → WHAT happens on success (mutation, snackbar, cache invalidation)
```

Files that follow this pattern: `WarehouseFormDialog`, `VehicleFormDialog`, `DriverFormDialog`,
`ShipmentFormDialog`, `EditShipmentDialog`, `CancelShipmentDialog`, `RouteFormDialog`,
`EditRouteDialog`, plus `LoginPage` (schema defined inline because it is auth-only).

## 2. The Zod schema (`features/<f>/schema.ts`)

```ts
// src/features/warehouses/schema.ts
export const warehouseFormSchema = z.object({
  name:     z.string().trim().min(1, 'Name is required').max(200, 'Name must be at most 200 characters'),
  address:  z.string().trim().min(1, 'Address is required').max(500, 'Address must be at most 500 characters'),
  latitude:  coordinate(-90, 90, 'Latitude'),      // custom: '' allowed (optional), else range check
  longitude: coordinate(-180, 180, 'Longitude'),
});
export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;   // TS type derived FROM schema

export function toWarehouseInput(values: WarehouseFormValues) {          // form shape → API body
  return {
    name: values.name, address: values.address,
    latitude: values.latitude === '' ? null : Number(values.latitude),  // text → number|null
    longitude: values.longitude === '' ? null : Number(values.longitude),
  };
}
```

Key ideas:

- **Client validation mirrors the server** so both reject the same input — but the server remains
  the authority; the schema is a fast-feedback copy, not a security control.
- Coordinates are edited as **strings** (HTML inputs are text) and converted at the boundary —
  `''` means "no coordinate" (null), never NaN.
- `z.infer` derives the TypeScript type from the schema — one declaration, two uses; the type can't
  drift from the validation.
- `schema.ts` also holds non-form view-model helpers (option lists like `shipmentStatusOptions`,
  href builders, formatters) — anything pure and UI-adjacent.

## 3. The dialog component (`WarehouseFormDialog.tsx`)

```tsx
export default function WarehouseFormDialog({ open, warehouse, onClose, onSubmit }: Props) {
  const isEdit = warehouse != null;                 // one dialog serves create AND edit
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } =
    useForm<WarehouseFormValues>({
      resolver: zodResolver(warehouseFormSchema),   // Zod validates before submit runs
      defaultValues: { name: '', address: '', latitude: '', longitude: '' },
    });

  useEffect(() => {                                 // re-seed whenever dialog opens
    if (open) { setServerError(null); reset({ ... }); }
  }, [open, warehouse, reset]);

  const submit = handleSubmit(async (values) => {   // only runs when Zod passed
    setServerError(null);
    try {
      await onSubmit(toWarehouseInput(values));     // parent performs the mutation
      onClose();                                    // success → close
    } catch (error) { /* … error mapping below … */ }
  });
  …
}
```

Mechanics worth internalizing:

- **`resolver: zodResolver(schema)`** plugs Zod into RHF: validation runs before `handleSubmit`'s
  callback; failures land in `formState.errors` and are shown per field via
  `error={errors.name != null}` + `helperText={errors.name?.message}`.
- **`register('name')`** returns props to spread on the input — RHF wires value/onChange/ref
  internally (no `useState` per field).
- **`isSubmitting`** disables Cancel/Submit while the promise is in flight (double-submit guard).
- **Edit vs create** is props-driven: `warehouse ? prefill : blank`; a `useEffect` re-seeds on
  every open so switching rows never shows stale values.
- The dialog **does not know about React Query** — it calls the `onSubmit` prop the page passed.
  That keeps it reusable and testable.
- A hidden `<button type="submit">` inside the form gives real form semantics (Enter key) while
  the visible buttons trigger `submit()` explicitly.

## 4. Error mapping — three sources, three destinations

```text
Zod (client)        → errors[field].message        → TextField helperText
server 400          → ApiError.fieldErrors         → setError(field, {type:'server', message})
                                                          (unmapped fields → serverError Alert)
anything else       → generic "Unexpected error"   → serverError Alert
```

```ts
if (error instanceof ApiError) {
  const fieldErrors = error.fieldErrors;          // { name: ["…"], latitude: ["…"] }
  let mapped = false;
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (field is a form field) { setError(field, { type: 'server', message: messages[0] }); mapped = true; }
  }
  if (!mapped) setServerError(error.problem.detail ?? error.message);
} else {
  setServerError('Unexpected error. Please try again.');
}
```

`ApiError.fieldErrors` is the bridge between ASP.NET `ProblemDetails.errors` and RHF's `setError`
(doc 05). No failed submit silently disappears.

## 5. Conflict (409) handling on edit

PATCH/PUT against a row whose state changed elsewhere answers 409 with a `detail`. Pages (not
dialogs) surface it and **refetch** so the table shows the truth:

```ts
// ShipmentsPage.tsx — conflictMessage()
const detail = caught instanceof ApiError ? (caught.problem.detail ?? caught.message) : fallback;
setSnackbar({ message: detail, severity: 'error' });
void refetch();
```

## 6. The page side of a submit

```tsx
// WarehousesPage.tsx
const handleFormSubmit = async (input) => {
  if (editing == null) { await createMutation.mutateAsync(input); setSnackbar({ message: 'Warehouse created', severity: 'success' }); }
  else                  { await updateMutation.mutateAsync({ id: editing.id, input }); setSnackbar({ … 'updated' … }); }
};
```

The page owns: which mutation, the success snackbar, dialog visibility, and (via hooks) cache
invalidation. The dialog owns: field state, validation, error rendering.

## 7. Non-RHF input patterns (for contrast)

- **Filter bars** are plain controlled `useState` + MUI `Select`/`TextField` — no RHF, because
  they don't validate; they only project to query params (docs 06/07).
- **Two-state search** (`searchText` draft → `q` applied on Enter) on every list page.
- **Cancel dialog** (`CancelShipmentDialog`) is a small form (note field) — same RHF pattern,
  lighter.

