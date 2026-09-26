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
import type { Shipment, ShipmentUpdateInput } from '../../api/client';
import type { EditableShipmentSnapshot, ShipmentEditFormValues } from './schema';
import { shipmentEditFormSchema, toShipmentUpdateInput } from './schema';
import { useShipment } from './hooks';
import { useWarehouses } from '../warehouses/hooks';

interface EditShipmentDialogProps {
  open: boolean;
  /** The shipment being edited; the dialog reads its detail itself (AC-6/AC-11 pre-fill). */
  shipmentId: number | null;
  onClose: () => void;
  /** Persists the PATCH; a 409 must be re-thrown so the caller can refresh the row (AC-11). */
  onSubmit: (body: ShipmentUpdateInput) => Promise<void>;
}

/** The five editable keys of ShipmentUpdateRequest — the only 400 keys this form can render. */
const EDITABLE_FIELDS = [
  'originWarehouseId',
  'destinationAddress',
  'weightKg',
  'destinationLat',
  'destinationLng',
] as const;

/** The editable snapshot of a loaded detail — the baseline the partial body is diffed against (R1). */
function snapshotOf(shipment: Shipment): EditableShipmentSnapshot {
  return {
    originWarehouseId: shipment.originWarehouseId,
    destinationAddress: shipment.destinationAddress,
    destinationLat: shipment.destinationLat ?? null,
    destinationLng: shipment.destinationLng ?? null,
    weightKg: shipment.weightKg,
  };
}

const EMPTY_FORM: ShipmentEditFormValues = {
  originWarehouseId: '',
  destinationAddress: '',
  weightKg: '',
  destinationLat: '',
  destinationLng: '',
};

/**
 * Edit-shipment dialog (LOGI-0008 F6, AC-1..AC-4, AC-11). Pre-filled from
 * `GET /api/v1/shipments/{id}` (the read LOGI-0007 deferred), saves with a PATCH that carries only
 * the fields the user actually changed, and maps the server's field-keyed 400s back onto the inputs.
 * `priority`, `referenceCode`, `status` and `slaDueAt` are absent by design (AC-4 / BR-1 rule 1.5).
 */
export default function EditShipmentDialog({ open, shipmentId, onClose, onSubmit }: EditShipmentDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<EditableShipmentSnapshot | null>(null);
  const warehouses = useWarehouses(1, 100, '');

  const detail = useShipment(shipmentId ?? 0, open && shipmentId != null);

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ShipmentEditFormValues>({
    resolver: zodResolver(shipmentEditFormSchema),
    defaultValues: EMPTY_FORM,
  });

  // Seed the form from the freshly loaded detail each time the dialog opens.
  useEffect(() => {
    if (open && detail.data != null) {
      const shipment = detail.data;
      setServerError(null);
      setBaseline(snapshotOf(shipment));
      reset({
        originWarehouseId: String(shipment.originWarehouseId),
        destinationAddress: shipment.destinationAddress,
        weightKg: String(shipment.weightKg),
        destinationLat: shipment.destinationLat == null ? '' : String(shipment.destinationLat),
        destinationLng: shipment.destinationLng == null ? '' : String(shipment.destinationLng),
      });
    }
  }, [open, detail.data, reset]);

  const submit = handleSubmit(async (values) => {
    if (baseline == null) return;
    setServerError(null);

    const body = toShipmentUpdateInput(values, baseline);
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
        if (error.status === 409) {
          // AC-11: a state change in another tab surfaces a message and the caller refreshes the
          // row — the dialog must not close as if the save had worked.
          setServerError(error.problem.detail ?? 'This shipment can no longer be edited.');
          return;
        }
        let mapped = false;
        for (const [field, messages] of Object.entries(error.fieldErrors)) {
          if ((EDITABLE_FIELDS as readonly string[]).includes(field)) {
            setError(field as keyof ShipmentEditFormValues, { type: 'server', message: messages[0] });
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
      <DialogTitle>Edit shipment</DialogTitle>
      <form onSubmit={(event) => void submit(event)}>
        <DialogContent dividers>
          {serverError != null && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              {serverError}
            </Alert>
          )}
          {detail.isError && (
            <Alert severity="error" sx={{ mb: 2 }} role="alert">
              Failed to load shipment: {(detail.error as Error).message}
            </Alert>
          )}
          {loading && (
            <Typography data-testid="edit-loading" sx={{ mb: 2 }}>
              <CircularProgress size={16} /> Loading shipment…
            </Typography>
          )}

          <Grid container spacing={2}>
            <Grid item xs={12}>
              <FormControl fullWidth error={errors.originWarehouseId != null}>
                <InputLabel id="shipment-edit-origin-label">Origin warehouse</InputLabel>
                <Select
                  labelId="shipment-edit-origin-label"
                  label="Origin warehouse"
                  inputProps={{ 'aria-label': 'Origin warehouse' }}
                  {...register('originWarehouseId')}
                >
                  {(warehouses.data?.items ?? []).map((warehouse) => (
                    <MenuItem key={warehouse.id} value={String(warehouse.id)}>
                      {warehouse.name}
                    </MenuItem>
                  ))}
                </Select>
                {errors.originWarehouseId && (
                  <FormHelperText>{errors.originWarehouseId.message}</FormHelperText>
                )}
              </FormControl>
            </Grid>
            <Grid item xs={12}>
              <TextField
                label="Destination address"
                fullWidth
                error={errors.destinationAddress != null}
                helperText={errors.destinationAddress?.message}
                inputProps={{ 'aria-label': 'Destination address', maxLength: 500 }}
                {...register('destinationAddress')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Weight (kg)"
                type="number"
                fullWidth
                error={errors.weightKg != null}
                helperText={errors.weightKg?.message}
                inputProps={{ 'aria-label': 'Weight in kilograms', min: 0, step: '0.01' }}
                {...register('weightKg')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Destination latitude"
                type="number"
                fullWidth
                error={errors.destinationLat != null}
                helperText={errors.destinationLat?.message}
                inputProps={{ 'aria-label': 'Destination latitude', step: '0.0001' }}
                {...register('destinationLat')}
              />
            </Grid>
            <Grid item xs={12} sm={6}>
              <TextField
                label="Destination longitude"
                type="number"
                fullWidth
                error={errors.destinationLng != null}
                helperText={errors.destinationLng?.message}
                inputProps={{ 'aria-label': 'Destination longitude', step: '0.0001' }}
                {...register('destinationLng')}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            type="submit"
            variant="contained"
            disabled={isSubmitting || loading || baseline == null}
            data-testid="shipment-save"
          >
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
