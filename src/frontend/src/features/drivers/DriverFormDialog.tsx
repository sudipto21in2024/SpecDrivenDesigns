import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, MenuItem, TextField } from '@mui/material';
import { ApiError } from '../../api/client';
import type { Driver, DriverInput } from '../../api/client';
import type { DriverFormValues } from './schema';
import { driverFormSchema, driverStatuses, toDriverInput } from './schema';

interface DriverFormDialogProps {
  open: boolean;
  /** Present = edit mode (PUT), absent = create mode (POST). */
  driver?: Driver | null;
  onClose: () => void;
  /** Submits the mapped contract body; resolves on success, rejects on API error. */
  onSubmit: (input: DriverInput) => Promise<void>;
}

/** Create/Edit driver dialog — RHF + Zod mirroring backend validation (LOGI-0005 AC-3…AC-6). */
export default function DriverFormDialog({ open, driver, onClose, onSubmit }: DriverFormDialogProps) {
  const isEdit = driver != null;
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<DriverFormValues>({
    resolver: zodResolver(driverFormSchema),
    defaultValues: { fullName: '', licenseNumber: '', phone: '', status: 'Active', userId: '' },
  });

  // Re-seed the form whenever the dialog opens for a different purpose/row.
  // userId is re-seeded so an edit preserves the current link (omitted ⇒ clears).
  useEffect(() => {
    if (open) {
      setServerError(null);
      reset({
        fullName: driver?.fullName ?? '',
        licenseNumber: driver?.licenseNumber ?? '',
        phone: driver?.phone ?? '',
        status: driver?.status ?? 'Active',
        userId: driver?.userId?.toString() ?? '',
      });
    }
  }, [open, driver, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit(toDriverInput(values));
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409) {
          // AC-3/AC-6: duplicate license surfaces as a licenseNumber field error.
          const fieldErrors = error.fieldErrors;
          const licenseMessages = fieldErrors['licenseNumber'];
          const userMessages = fieldErrors['userId'];
          if (licenseMessages) {
            setError('licenseNumber', { type: 'server', message: licenseMessages[0] });
          } else if (userMessages) {
            setError('userId', { type: 'server', message: userMessages[0] });
          } else {
            setServerError(error.problem.detail ?? error.message);
          }
          return;
        }
        const fieldErrors = error.fieldErrors;
        let mapped = false;
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (field === 'fullName' || field === 'licenseNumber' || field === 'phone' || field === 'status' || field === 'userId') {
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
      <DialogTitle>{isEdit ? 'Edit Driver' : 'Create Driver'}</DialogTitle>
      <DialogContent dividers>
        {serverError != null && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {serverError}
          </Alert>
        )}
        <Grid container spacing={2} component="form" onSubmit={submit} noValidate>
          <Grid item xs={12}>
            <TextField
              label="Full name"
              fullWidth
              required
              error={errors.fullName != null}
              helperText={errors.fullName?.message}
              inputProps={{ 'aria-label': 'Driver full name', maxLength: 200 }}
              {...register('fullName')}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="License number"
              fullWidth
              required
              error={errors.licenseNumber != null}
              helperText={errors.licenseNumber?.message}
              inputProps={{ 'aria-label': 'Driver license number', maxLength: 40 }}
              {...register('licenseNumber')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Phone"
              fullWidth
              error={errors.phone != null}
              helperText={errors.phone?.message ?? 'Optional, e.g. +31 6 1234 5678'}
              inputProps={{ 'aria-label': 'Driver phone', maxLength: 40 }}
              {...register('phone')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Status"
              select
              fullWidth
              error={errors.status != null}
              helperText={errors.status?.message ?? 'Defaults to Active'}
              inputProps={{ 'aria-label': 'Driver status' }}
              {...register('status')}
            >
              {driverStatuses.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="User ID"
              fullWidth
              type="number"
              error={errors.userId != null}
              helperText={errors.userId?.message ?? 'Optional login user account id to link; clear to unlink'}
              inputProps={{ 'aria-label': 'Driver user id', min: 1 }}
              {...register('userId', { valueAsNumber: false })}
            />
          </Grid>
          {/* Hidden submit for form semantics; actions below trigger it. */}
          <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} color="inherit" disabled={isSubmitting} data-testid="driver-cancel">
          Cancel
        </Button>
        <Button onClick={submit} disabled={isSubmitting} data-testid="driver-submit">
          {isEdit ? 'Save Changes' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
