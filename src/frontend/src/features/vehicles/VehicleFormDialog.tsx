import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, TextField } from '@mui/material';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { Vehicle, VehicleInput } from '../../api/client';
import type { VehicleFormValues } from './schema';
import { toVehicleInput, vehicleFormSchema, vehicleStatuses, vehicleTypes } from './schema';

interface VehicleFormDialogProps {
  open: boolean;
  /** Present = edit mode (PUT), absent = create mode (POST). */
  vehicle?: Vehicle | null;
  onClose: () => void;
  /** Submits the mapped contract body; resolves on success, rejects on API error. */
  onSubmit: (input: VehicleInput) => Promise<void>;
}

/** Create/Edit vehicle dialog — RHF + Zod mirroring backend validation (LOGI-0004 AC-1…AC-6). */
export default function VehicleFormDialog({ open, vehicle, onClose, onSubmit }: VehicleFormDialogProps) {
  const isEdit = vehicle != null;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
    // Capacity is typed as text here (matching the input); the Zod preprocess coerces it.
  } = useForm<VehicleFormValues>({
    resolver: zodResolver(vehicleFormSchema),
    defaultValues: { plateNumber: '', type: 'Truck', capacityKg: '', status: 'Available' },
  });

  // Re-seed the form whenever the dialog opens for a different purpose/row.
  useEffect(() => {
    if (open) {
      setServerError(null);
      reset({
        plateNumber: vehicle?.plateNumber ?? '',
        type: vehicle?.type ?? 'Truck',
        capacityKg: vehicle?.capacityKg?.toString() ?? '',
        status: vehicle?.status ?? 'Available',
      });
    }
  }, [open, vehicle, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit(toVehicleInput(values));
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          // AC-3: duplicate plate surfaces as a plate field error, not a silent failure.
          setError('plateNumber', {
            type: 'server',
            message: `A vehicle with plate number '${values.plateNumber.trim()}' already exists.`,
          });
          return;
        }
        const fieldErrors = error.fieldErrors;
        let mapped = false;
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (field === 'plateNumber' || field === 'type' || field === 'capacityKg' || field === 'status') {
            setError(field, { type: 'server', message: messages[0] });
            mapped = true;
          }
        }
        if (!mapped) setServerError(error.problem.detail ?? error.message);
      } else {
        setServerError('Unexpected error. Please try again.');
      }
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? 'Edit Vehicle' : 'Create Vehicle'}</DialogTitle>
      <DialogContent dividers>
        {serverError != null && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {serverError}
          </Alert>
        )}
        <Grid container spacing={2} component="form" onSubmit={submit} noValidate>
          <Grid item xs={12}>
            <TextField
              label="Plate number"
              fullWidth
              required
              error={errors.plateNumber != null}
              helperText={errors.plateNumber?.message}
              inputProps={{ 'aria-label': 'Vehicle plate number', maxLength: 20 }}
              {...register('plateNumber')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Type"
              select
              fullWidth
              required
              error={errors.type != null}
              helperText={errors.type?.message}
              inputProps={{ 'aria-label': 'Vehicle type' }}
              defaultValue="Truck"
              {...register('type')}
            >
              {vehicleTypes.map((t) => (
                <MenuItem key={t} value={t}>
                  {t}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Status"
              select
              fullWidth
              error={errors.status != null}
              helperText={errors.status?.message ?? 'Defaults to Available'}
              inputProps={{ 'aria-label': 'Vehicle status' }}
              defaultValue="Available"
              {...register('status')}
            >
              {vehicleStatuses.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Capacity (kg)"
              fullWidth
              required
              error={errors.capacityKg != null}
              helperText={errors.capacityKg?.message ?? 'Must be greater than 0'}
              inputProps={{ 'aria-label': 'Vehicle capacity', inputMode: 'decimal' }}
              {...register('capacityKg')}
            />
          </Grid>
          {/* Hidden submit for form semantics; actions below trigger it. */}
          <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={isSubmitting} data-testid="vehicle-cancel">
          Cancel
        </Button>
        <Button onClick={submit} disabled={isSubmitting} data-testid="vehicle-submit">
          {isEdit ? 'Save Changes' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
