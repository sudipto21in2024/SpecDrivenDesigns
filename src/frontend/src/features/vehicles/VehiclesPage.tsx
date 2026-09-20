import { useState } from 'react';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  FormControl, InputLabel, MenuItem, Paper, Select, Snackbar, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow,
  TextField, Typography,
} from '@mui/material';
import type { Vehicle, VehicleInput } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { useCreateVehicle, useDeleteVehicle, useUpdateVehicle, useVehicles } from './hooks';
import VehicleFormDialog from './VehicleFormDialog';

const statusOptions = ['', 'Available', 'InRoute', 'Maintenance'] as const;
const typeOptions = ['', 'Van', 'Truck', 'Trailer'] as const;

/** Vehicle master-data page — AC-1..AC-8 of LOGI-0004, role-gated per the contract x-roles. */
export default function VehiclesPage() {
  const [page, setPage] = useState(0); // MUI TablePagination is zero-based
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [vehicleType, setVehicleType] = useState('');

  // Affordance gating mirrors the contract's x-roles for /vehicles (same matrix as warehouses).
  // Hiding controls is a UX decision only — the server returns 403 regardless (HLD section 7).
  const { user } = useAuth();
  const canEdit = user != null && can(user.role, 'editVehicles');
  const canDelete = user != null && can(user.role, 'deleteVehicles');

  const { data, isPending, isError, error, refetch } = useVehicles(page + 1, rowsPerPage, q, status, vehicleType);
  const createMutation = useCreateVehicle();
  const updateMutation = useUpdateVehicle();
  const deleteMutation = useDeleteVehicle();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [deleting, setDeleting] = useState<Vehicle | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (vehicle: Vehicle) => {
    setEditing(vehicle);
    setFormOpen(true);
  };

  const handleFormSubmit = async (input: VehicleInput) => {
    if (editing == null) {
      await createMutation.mutateAsync(input);
      setSnackbar({ message: 'Vehicle created', severity: 'success' });
    } else {
      await updateMutation.mutateAsync({ id: editing.id, input });
      setSnackbar({ message: 'Vehicle updated', severity: 'success' });
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleting == null) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      setSnackbar({ message: 'Vehicle deleted', severity: 'success' });
    } catch {
      setSnackbar({ message: 'Failed to delete vehicle', severity: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    setQ(searchText.trim());
    setPage(0);
  };

  const filtersChanged = (next: { status: string; type: string }) => {
    setStatus(next.status);
    setVehicleType(next.type);
    setPage(0);
  };


  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h1">Vehicles</Typography>
                {canEdit && (<Button variant="contained" onClick={openCreate} data-testid="new-vehicle">New Vehicle</Button>)}
      </Stack>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }} component="form" onSubmit={search}>
        <TextField label="Search by plate" value={searchText} onChange={(e) => setSearchText(e.target.value)} size="small" inputProps={{ 'aria-label': 'Search vehicles by plate' }} />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="vehicle-status-label">Status</InputLabel>
          <Select labelId="vehicle-status-label" label="Status" value={status} onChange={(e) => filtersChanged({ status: e.target.value, type: vehicleType })} inputProps={{ 'aria-label': 'Filter by status' }}>
            {statusOptions.map((s) => (<MenuItem key={s || 'all'} value={s}>{s === '' ? 'All statuses' : s}</MenuItem>))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="vehicle-type-label">Type</InputLabel>
          <Select labelId="vehicle-type-label" label="Type" value={vehicleType} onChange={(e) => filtersChanged({ status, type: e.target.value })} inputProps={{ 'aria-label': 'Filter by type' }}>
            {typeOptions.map((t) => (<MenuItem key={t || 'all'} value={t}>{t === '' ? 'All types' : t}</MenuItem>))}
          </Select>
        </FormControl>
        <Button type="submit" variant="outlined">Search</Button>
      </Stack>
      {isPending && <Typography>Loading vehicles…</Typography>}
      {isError && (<Alert severity="error" action={<Button onClick={() => refetch()}>Retry</Button>}>Failed to load vehicles: {(error as Error).message}</Alert>)}
      {data != null && (
        <Paper>
          <TableContainer>
            <Table aria-label="Vehicles table">
              <TableHead><TableRow><TableCell>Plate number</TableCell><TableCell>Type</TableCell><TableCell>Capacity (kg)</TableCell><TableCell>Status</TableCell>{(canEdit || canDelete) && <TableCell align="right">Actions</TableCell>}</TableRow></TableHead>
              <TableBody>
                {data.items.length === 0 && (<TableRow><TableCell colSpan={5} align="center">No vehicles found</TableCell></TableRow>)}
                {data.items.map((vehicle) => (
                  <TableRow key={vehicle.id} hover>
                    <TableCell>{vehicle.plateNumber}</TableCell><TableCell>{vehicle.type}</TableCell><TableCell>{vehicle.capacityKg}</TableCell><TableCell>{vehicle.status}</TableCell>
                    {(canEdit || canDelete) && (
                      <TableCell align="right">
                        {canEdit && (<Button size="small" aria-label={`Edit ${vehicle.plateNumber}`} onClick={() => openEdit(vehicle)}>Edit</Button>)}
                        {canDelete && (<Button size="small" color="error" aria-label={`Delete ${vehicle.plateNumber}`} onClick={() => setDeleting(vehicle)}>Delete</Button>)}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination component="div" count={data.totalCount} page={page} rowsPerPage={rowsPerPage} rowsPerPageOptions={[5, 10, 25]} onPageChange={(_, next) => setPage(next)} onRowsPerPageChange={(e) => { setRowsPerPage(Number(e.target.value)); setPage(0); }} />
        </Paper>
      )}
      <VehicleFormDialog open={formOpen} vehicle={editing} onClose={() => setFormOpen(false)} onSubmit={handleFormSubmit} />
      <Dialog open={deleting != null} onClose={() => setDeleting(null)}>
        <DialogTitle>Delete vehicle</DialogTitle>
        <DialogContent><DialogContentText>Delete vehicle &quot;{deleting?.plateNumber}&quot;? This cannot be undone.</DialogContentText></DialogContent>
        <DialogActions><Button onClick={() => setDeleting(null)} color="inherit">Cancel</Button>        <Button onClick={handleDeleteConfirm} color="error" disabled={deleteMutation.isPending} data-testid="confirm-delete">Delete</Button></DialogActions>
      </Dialog>
            <Snackbar open={snackbar != null} autoHideDuration={4000} onClose={() => setSnackbar(null)} message={snackbar?.message} data-testid="snackbar" />
    </Box>
  );
}