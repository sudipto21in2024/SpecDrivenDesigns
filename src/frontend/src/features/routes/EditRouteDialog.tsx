import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Alert,
  Button,
  CircularProgress,
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
  Typography,
} from '@mui/material';
import { useEffect, useState } from 'react';
import { ApiError } from '../../api/client';
import type { RouteUpdateInput } from '../../api/client';
import type { EditableRouteSnapshot, RouteEditFormValues } from './schema';
import {
  routeEditFormSchema,
  toInstant,
  toRouteSnapshot,
  toRouteUpdateInput,
  unassignedValue,
} from './schema';
import { useRoute } from './hooks';
import { useVehicles } from '../vehicles/hooks';
import { useDrivers } from '../drivers/hooks';

interface EditRouteDialogProps {
  open: boolean;
  /** The route being edited; the dialog reads its detail itself so the form pre-fills. */
  routeId: number | null;
  onClose: () => void;
  /** Persists the PATCH; a 409 must be re-thrown so the caller can refresh the row. */
  onSubmit: (body: RouteUpdateInput) => Promise<void>;
}

/** The five editable keys of RouteUpdateRequest — the only 400 keys this form can render. */
const EDITABLE_FIELDS = ['name', 'plannedStart', 'plannedEnd', 'vehicleId', 'driverId'] as const;

/** Blank form before the detail read lands. */
const EMPTY_FORM: RouteEditFormValues = {
  name: '',
  plannedStart: '',
  plannedEnd: '',
  vehicleId: unassignedValue,
  driverId: unassignedValue,
};


/**
 * Edit / assign-route dialog (LOGI-0009 AC-2..AC-6). Pre-fills from `GET /api/v1/routes/{id}`,
 * saves with a PATCH carrying only the fields the user actually changed, maps the server's
 * field-keyed 400s back onto the inputs, and surfaces a 409 (double-booking AC-5, or a
 * non-Planned route AC-6) in an Alert while the caller refetches the row.
 *
 * `status`, `id`, `createdAt` and `updatedAt` are absent by design (AC-10 — server-owned).
 */
export default function EditRouteDialog({ open, routeId, onClose, onSubmit }: EditRouteDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<EditableRouteSnapshot | null>(null);
  const vehicles = useVehicles(1, 100, '', '', '');
  const drivers = useDrivers(1, 100, '', '');

  const detail = useRoute(routeId ?? 0, open && routeId != null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<RouteEditFormValues>({
    resolver: zodResolver(routeEditFormSchema),
    defaultValues: EMPTY_FORM,
  });

  // Seed the form from the freshly loaded detail each time the dialog opens.
  useEffect(() => {
    if (open && detail.data != null) {
      const route = detail.data;
      setServerError(null);
      setBaseline(toRouteSnapshot(route));
      reset({
        name: route.name,
        plannedStart: toInstant(route.plannedStart),
        plannedEnd: toInstant(route.plannedEnd),
        vehicleId: route.vehicleId == null ? unassignedValue : String(route.vehicleId),
        driverId: route.driverId == null ? unassignedValue : String(route.driverId),
      });
    }
  }, [open, detail.data, reset]);

  const submit = handleSubmit(async (values) => {
    if (baseline == null) return;
    setServerError(null);

    const body = toRouteUpdateInput(values, baseline);
    // Nothing changed — no request, so the API's empty-body 400 is never provoked from the UI.
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }

    try {
      await onSubmit(body);
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        if (error.status === 409 || error.status === 404) {
          // AC-5/AC-6: the detail names the conflict or the required status; the caller refetches.
          setServerError(error.problem.detail ?? 'This route can no longer be modified.');
          return;
        }
        let mapped = false;
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          if ((EDITABLE_FIELDS as readonly string[]).includes(field)) {
            setError(field as keyof RouteEditFormValues, { type: 'server', message: messages[0] });
            mapped = true;
          }
        }
        if (!mapped) setServerError(error.problem.detail ?? error.message);
      } else {
        setServerError('Unexpected error. Please try again.');
      }
    }
  });

  const loading = open && detail.isPending;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Edit route</DialogTitle>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <DialogContent dividers>
          {serverError != null && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {serverError}
            </Alert>
          )}
          {detail.isError && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              Failed to load route: {(detail.error as Error).message}
            </Alert>
          )}
          {loading && (
            <Typography data-testid="edit-route-loading" sx={{ mb: 2 }}>
              <CircularProgress size={16} /> Loading route…
            </Typography>
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
                error={errors.plannedEnd != null}
                helperText={errors.plannedEnd?.message}
                inputProps={{ 'aria-label': 'Planned end' }}
                {...register('plannedEnd')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              {/* register() alone leaves the Select uncontrolled (it carries no `value`), so the
                  current assignment would render blank — watch/setValue drive the display (AC-2). */}
              <FormControl fullWidth error={errors.vehicleId != null}>
                <InputLabel id="route-edit-vehicle-label">Vehicle</InputLabel>
                <Select
                  labelId="route-edit-vehicle-label"
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
                <InputLabel id="route-edit-driver-label">Driver</InputLabel>
                <Select
                  labelId="route-edit-driver-label"
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
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting}
            data-testid="route-save"
          >
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
