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
import type { ShipmentInput } from '../../api/client';
import type { ShipmentFormValues } from './schema';
import { toShipmentInput, shipmentFormSchema, shipmentPriorities } from './schema';
import { useWarehouses } from '../warehouses/hooks';

interface ShipmentFormDialogProps {
  open: boolean;
  onClose: () => void;
  /** Persists the create; returns the created Shipment so the caller can surface its referenceCode. */
    onSubmit: (input: ShipmentInput) => Promise<void>;
}

/**
 * Create-shipment dialog (LOGI-0007 F5 / AC-1..AC-4). RHF + Zod mirroring the backend validator so
 * client-side mistakes never get sent; server 400s map to fields, everything else to an Alert (same
 * idiom as VehicleFormDialog). Server-owned fields — referenceCode, status, slaDueAt — are never sent.
 */
export default function ShipmentFormDialog({ open, onClose, onSubmit }: ShipmentFormDialogProps) {
  const [serverError, setServerError] = useState<string | null>(null);
  const warehouses = useWarehouses(1, 100, '');

  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ShipmentFormValues>({
    resolver: zodResolver(shipmentFormSchema),
    defaultValues: {
      originWarehouseId: '',
      destinationAddress: '',
      weightKg: '',
      priority: 'Standard',
      destinationLat: '',
      destinationLng: '',
    },
  });

  // Re-seed the form whenever the dialog opens for a fresh create.
  useEffect(() => {
    if (open) {
      setServerError(null);
      reset({
        originWarehouseId: '',
        destinationAddress: '',
        weightKg: '',
        priority: 'Standard',
        destinationLat: '',
        destinationLng: '',
      });
    }
  }, [open, reset]);

  const submit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      await onSubmit(toShipmentInput(values));
      onClose();
    } catch (error) {
      if (error instanceof ApiError) {
        const fieldErrors = error.fieldErrors;
        let mapped = false;
        for (const [field, messages] of Object.entries(fieldErrors)) {
          if (
            field === 'originWarehouseId' ||
            field === 'destinationAddress' ||
            field === 'weightKg' ||
            field === 'priority'
          ) {
            setError(field as keyof ShipmentFormValues, { type: 'server', message: messages[0] });
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
      <DialogTitle>Create shipment</DialogTitle>
      <DialogContent dividers>
        {serverError != null && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert">
            {serverError}
          </Alert>
        )}
        <Grid container spacing={2} component="form" onSubmit={submit} noValidate>
                    <Grid item xs={12}>
            <FormControl fullWidth required error={errors.originWarehouseId != null}>
              <InputLabel id="origin-warehouse-label">Origin warehouse</InputLabel>
              <Select
                labelId="origin-warehouse-label"
                label="Origin warehouse"
                displayEmpty
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
              required
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
              required
              error={errors.weightKg != null}
              helperText={errors.weightKg?.message}
              inputProps={{ 'aria-label': 'Weight in kilograms', min: 0, step: '0.01' }}
              {...register('weightKg')}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <FormControl fullWidth required error={errors.priority != null}>
              <InputLabel id="shipment-priority-label">Priority</InputLabel>
              <Select
                labelId="shipment-priority-label"
                label="Priority"
                defaultValue="Standard"
                {...register('priority')}
              >
                {shipmentPriorities.map((priority) => (
                  <MenuItem key={priority} value={priority}>
                    {priority}
                  </MenuItem>
                ))}
              </Select>
              {errors.priority && <FormHelperText>{errors.priority.message}</FormHelperText>}
            </FormControl>
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
        <Button type="submit" variant="contained" disabled={isSubmitting}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}

