import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormHelperText,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  TextField,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { RouteInput } from '../../api/client';
import type { RouteFormValues } from './schema';
import { routeFormSchema, toRouteInput, unassignedValue } from './schema';
import { useVehicles } from '../vehicles/hooks';
import { useDrivers } from '../drivers/hooks';

interface RouteFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Persists the create; rejects with ApiError so this dialog can surface the problem. */
  onSubmit: (input: RouteInput) => Promise<void>;
}

/**
 * Create-route dialog (LOGI-0009 AC-1..AC-3, AC-5). RHF + Zod mirroring the backend validator, so
 * client-side mistakes never reach the wire; the server's 400s map onto their fields and its 409
 * (double-booking, AC-5) is surfaced with the detail that names the conflicting vehicle/driver.
 * Server-owned fields — id, status, createdAt, updatedAt — are never sent (AC-10).
 */
export default function RouteFormDialog({ open, onClose, onSubmit }: RouteFormDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const vehicles = useVehicles(1, 100, '', '', '');
  const drivers = useDrivers(1, 100, '', '');

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RouteFormValues>({
    resolver: zodResolver(routeFormSchema),
    defaultValues: {
      name: '',
      plannedStart: '',
      plannedEnd: '',
      vehicleId: unassignedValue,
      driverId: unassignedValue,
    },
  });

  // Re-seed the form on every open so a cancelled draft never leaks into the next create.
  useEffect(() => {
    if (open) {
      setServerError(null);
      reset({
        name: '',
        plannedStart: '',
        plannedEnd: '',
        vehicleId: unassignedValue,
        driverId: unassignedValue,
      });
    }
  }, [open, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit(toRouteInput(values));
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        let mapped = false;
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          if (
            field === 'name' ||
            field === 'plannedStart' ||
            field === 'plannedEnd' ||
            field === 'vehicleId' ||
            field === 'driverId'
          ) {
            setError(field as keyof RouteFormValues, { type: 'server', message: messages[0] });
            mapped = true;
          }
        }
        // 404 (unknown vehicle/driver) and 409 (overlap) carry the actionable detail, and their
        // bodies have no field keys — so they land in the Alert rather than on a field (AC-4/AC-5).
        if (!mapped) setServerError(error.problem.detail ?? error.message);
      } else {
        setServerError('Unexpected error. Please try again.');
      }
    }
  });

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create route</DialogTitle>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <DialogContent dividers>
          {serverError != null && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {serverError}
            </Alert>
          )}
          <Grid container spacing={2}>
            <Grid item xs={12}>
              <TextField
                label="Name"
                fullWidth
                required
                error={errors.name != null}
                helperText={errors.name?.message}
                inputProps={{ 'aria-label': 'Route name', maxLength: 200 }}
                {...register('name')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Planned start (UTC)"
                fullWidth
                required
                placeholder="2026-10-01T08:00:00Z"
                error={errors.plannedStart != null}
                helperText={errors.plannedStart?.message}
                inputProps={{ 'aria-label': 'Planned start' }}
                {...register('plannedStart')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Planned end (UTC)"
                fullWidth
                required
                placeholder="2026-10-01T16:00:00Z"
                error={errors.plannedEnd != null}
                helperText={errors.plannedEnd?.message}
                inputProps={{ 'aria-label': 'Planned end' }}
                {...register('plannedEnd')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              {/* MUI's Select is controlled: register() supplies no `value`, so the picked option
                  would never be displayed. watch/setValue close that loop (AC-2). */}
              <FormControl fullWidth error={errors.vehicleId != null}>
                <InputLabel id="route-vehicle-label">Vehicle</InputLabel>
                <Select
                  labelId="route-vehicle-label"
                  label="Vehicle"
                  displayEmpty
                  {...register('vehicleId')}
                  value={watch('vehicleId') ?? unassignedValue}
                  onChange={(event) => setValue('vehicleId', event.target.value)}
                >
                  <MenuItem value={unassignedValue}>Unassigned</MenuItem>
                  {(vehicles.data?.items ?? []).map((vehicle) => (
                    <MenuItem key={vehicle.id} value={String(vehicle.id)}>
                      {vehicle.plateNumber}
                    </MenuItem>
                  ))}
                </Select>
                {errors.vehicleId && <FormHelperText>{errors.vehicleId.message}</FormHelperText>}
              </FormControl>
            </Grid>
            <Grid item xs={12} sm={6}>
              <FormControl fullWidth error={errors.driverId != null}>
                <InputLabel id="route-driver-label">Driver</InputLabel>
                <Select
                  labelId="route-driver-label"
                  label="Driver"
                  displayEmpty
                  {...register('driverId')}
                  value={watch('driverId') ?? unassignedValue}
                  onChange={(event) => setValue('driverId', event.target.value)}
                >
                  <MenuItem value={unassignedValue}>Unassigned</MenuItem>
                  {(drivers.data?.items ?? []).map((driver) => (
                    <MenuItem key={driver.id} value={String(driver.id)}>
                      {driver.fullName}
                    </MenuItem>
                  ))}
                </Select>
                {errors.driverId && <FormHelperText>{errors.driverId.message}</FormHelperText>}
              </FormControl>
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={isSubmitting} data-testid="route-submit">
            Create
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
