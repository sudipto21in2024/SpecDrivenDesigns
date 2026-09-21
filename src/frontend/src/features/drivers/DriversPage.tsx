import { useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  FormControl,
  IconButton,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Snackbar,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { DeleteIcon, EditIcon, SearchIcon } from '../../components/icons';
import type { Driver, DriverInput } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { useCreateDriver, useDeleteDriver, useDrivers, useUpdateDriver } from './hooks';
import DriverFormDialog from './DriverFormDialog';

/** Driver master-data page — AC-1..AC-9 of LOGI-0005, role-gated per the contract x-roles. */
export default function DriversPage() {
  const [page, setPage] = useState(0); // MUI TablePagination is zero-based
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');

  // Affordance gating mirrors the contract's x-roles for /drivers. Hiding these controls is
  // a UX decision only — the server enforces the same rules and returns 403 regardless (HLD §7).
  const { user } = useAuth();
  const canEdit = user != null && can(user.role, 'editDrivers');
  const canDelete = user != null && can(user.role, 'deleteDrivers');

  const { data, isPending, isError, error, refetch } = useDrivers(page + 1, rowsPerPage, q, status);
  const createMutation = useCreateDriver();
  const updateMutation = useUpdateDriver();
  const deleteMutation = useDeleteDriver();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Driver | null>(null);
  const [deleting, setDeleting] = useState<Driver | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (driver: Driver) => {
    setEditing(driver);
    setFormOpen(true);
  };

  const handleFormSubmit = async (input: DriverInput) => {
    if (editing == null) {
      await createMutation.mutateAsync(input);
      setSnackbar({ message: 'Driver created', severity: 'success' });
    } else {
      await updateMutation.mutateAsync({ id: editing.id, input });
      setSnackbar({ message: 'Driver updated', severity: 'success' });
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleting == null) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      setSnackbar({ message: 'Driver deleted', severity: 'success' });
    } catch {
      setSnackbar({ message: 'Failed to delete driver', severity: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  const search = (event: React.FormEvent) => {
    event.preventDefault();
    setQ(searchText.trim());
    setPage(0);
  };

  return (
    <Stack spacing={2}>
      <Box component="header" sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
        <Typography variant="h5" component="h2">
          Drivers
        </Typography>
        {canEdit && (
          <Button onClick={openCreate} data-testid="new-driver">
            New Driver
          </Button>
        )}
      </Box>

      <Box component="form" onSubmit={search} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <TextField
          size="small"
          label="Search by full name"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          InputProps={{ 'aria-label': 'Search drivers by full name' }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="driver-status-label">Status</InputLabel>
          <Select
            labelId="driver-status-label"
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value);
              setPage(0);
            }}
            inputProps={{ 'aria-label': 'Filter by status' }}
          >
            <MenuItem value="">All statuses</MenuItem>
            <MenuItem value="Active">Active</MenuItem>
            <MenuItem value="OffDuty">OffDuty</MenuItem>
            <MenuItem value="Suspended">Suspended</MenuItem>
          </Select>
        </FormControl>
        <Button type="submit" startIcon={<SearchIcon />} aria-label="Search drivers">
          Search
        </Button>
      </Box>

      {isPending && <LinearProgress aria-label="Loading drivers" />}

      {isError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          <AlertTitle>Failed to load drivers</AlertTitle>
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      )}

      {data != null && (
        <TableContainer component={Paper}>
          <Table aria-label="Drivers table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Full Name</TableCell>
                <TableCell>License Number</TableCell>
                <TableCell>Phone</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>User ID</TableCell>
                {(canEdit || canDelete) && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    No drivers found
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((driver) => (
                <TableRow key={driver.id} data-testid={`driver-row-${driver.id}`}>
                  <TableCell>{driver.fullName}</TableCell>
                  <TableCell>{driver.licenseNumber}</TableCell>
                  <TableCell>{driver.phone ?? '—'}</TableCell>
                  <TableCell>{driver.status}</TableCell>
                  <TableCell>{driver.userId ?? '—'}</TableCell>
                  {canEdit || canDelete ? (
                    <TableCell align="right">
                      {canEdit && (
                        <Tooltip title="Edit">
                          <IconButton size="small" aria-label={`Edit driver ${driver.fullName}`} onClick={() => openEdit(driver)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                      {canDelete && (
                        <Tooltip title="Delete">
                          <IconButton
                            size="small"
                            aria-label={`Delete driver ${driver.fullName}`}
                            onClick={() => setDeleting(driver)}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
            <TablePagination
              component="div"
              count={data.totalCount}
              page={page}
              onPageChange={(_, newPage) => setPage(newPage)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(event) => {
                setRowsPerPage(Number(event.target.value));
                setPage(0);
              }}
              rowsPerPageOptions={[5, 10, 25]}
            />
          </Table>
        </TableContainer>
      )}

      <DriverFormDialog
        open={formOpen}
        driver={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      <Dialog open={deleting != null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete driver</DialogTitle>
        <DialogContent>
          <DialogContentText>Delete “{deleting?.fullName}”? This cannot be undone.</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleting(null)} color="inherit">
            Cancel
          </Button>
          <Button onClick={handleDeleteConfirm} color="error" disabled={deleteMutation.isPending} data-testid="confirm-delete">
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snackbar != null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar?.message}
        data-testid="snackbar"
      />
    </Stack>
  );
}
