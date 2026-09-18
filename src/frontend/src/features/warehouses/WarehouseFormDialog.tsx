import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, TextField } from '@mui/material';
import { ApiError } from '../../api/client';
import { warehouseFormSchema } from './schema';
import type { Warehouse } from '../../api/client';
import type { WarehouseFormValues } from './schema';

interface WarehouseFormDialogProps {
  open: boolean;
  /** Present = edit mode (PUT), absent = create mode (POST). */
  warehouse?: Warehouse | null;
  onClose: () => void;
  /** Submits the mapped contract body; resolves on success, rejects on API error. */
  onSubmit: (input: { name: string; address: string; latitude: number | null; longitude: number | null }) => Promise<void>;
}

/** Create/Edit warehouse dialog — RHF + Zod mirroring backend validation (LOGI-0001). */
export default function WarehouseFormDialog({ open, warehouse, onClose, onSubmit }: WarehouseFormDialogProps) {
  const isEdit = warehouse != null;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<WarehouseFormValues>({
    resolver: zodResolver(warehouseFormSchema),
    defaultValues: { name: '', address: '', latitude: '', longitude: '' },
  });

  // Re-seed the form whenever the dialog opens for a different purpose/row.
  useEffect(() => {
    if (open) {
      setServerError(null);
      reset({
        name: warehouse?.name ?? '',
        address: warehouse?.address ?? '',
        latitude: warehouse?.latitude?.toString() ?? '',
        longitude: warehouse?.longitude?.toString() ?? '',
      });
    }
  }, [open, warehouse, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit({
        name: values.name,
        address: values.address,
        latitude: values.latitude === '' ? null : Number(values.latitude),
        longitude: values.longitude === '' ? null : Number(values.longitude),
      });
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        let mapped = false;
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (field === 'name' || field === 'address' || field === 'latitude' || field === 'longitude') {
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
      <DialogTitle>{isEdit ? 'Edit Warehouse' : 'Create Warehouse'}</DialogTitle>
      <DialogContent dividers>
        {serverError != null && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {serverError}
          </Alert>
        )}
        <Grid container spacing={2} component="form" onSubmit={submit} noValidate>
          <Grid item xs={12}>
            <TextField
              label="Name"
              fullWidth
              required
              error={errors.name != null}
              helperText={errors.name?.message}
              inputProps={{ 'aria-label': 'Warehouse name' }}
              {...register('name')}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Address"
              fullWidth
              required
              multiline
              minRows={2}
              error={errors.address != null}
              helperText={errors.address?.message}
              inputProps={{ 'aria-label': 'Warehouse address' }}
              {...register('address')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Latitude"
              fullWidth
              error={errors.latitude != null}
              helperText={errors.latitude?.message ?? 'Optional, -90 to 90'}
              inputProps={{ 'aria-label': 'Warehouse latitude', inputMode: 'decimal' }}
              {...register('latitude')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Longitude"
              fullWidth
              error={errors.longitude != null}
              helperText={errors.longitude?.message ?? 'Optional, -180 to 180'}
              inputProps={{ 'aria-label': 'Warehouse longitude', inputMode: 'decimal' }}
              {...register('longitude')}
            />
          </Grid>
          {/* Hidden submit for form semantics; actions below trigger it. */}
          <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={isSubmitting}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={isSubmitting}>
          {isEdit ? 'Save Changes' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
