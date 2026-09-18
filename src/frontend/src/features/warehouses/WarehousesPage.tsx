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
  IconButton,
  LinearProgress,
  Paper,
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
import type { Warehouse } from '../../api/client';
import { useCreateWarehouse, useDeleteWarehouse, useUpdateWarehouse, useWarehouses } from './hooks';
import WarehouseFormDialog from './WarehouseFormDialog';

/** Warehouse master-data page — AC-1..AC-7 of LOGI-0001. */
export default function WarehousesPage() {
  const [page, setPage] = useState(0); // MUI TablePagination is zero-based
  const [rowsPerPage, setRowsPerPage] = useState(5);
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');

  const { data, isPending, isError, error, refetch } = useWarehouses(page + 1, rowsPerPage, q);
  const createMutation = useCreateWarehouse();
  const updateMutation = useUpdateWarehouse();
  const deleteMutation = useDeleteWarehouse();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Warehouse | null>(null);
  const [deleting, setDeleting] = useState<Warehouse | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (warehouse: Warehouse) => {
    setEditing(warehouse);
    setFormOpen(true);
  };

  const handleFormSubmit = async (input: { name: string; address: string; latitude: number | null; longitude: number | null }) => {
    if (editing == null) {
      await createMutation.mutateAsync(input);
      setSnackbar({ message: 'Warehouse created', severity: 'success' });
    } else {
      await updateMutation.mutateAsync({ id: editing.id, input });
      setSnackbar({ message: 'Warehouse updated', severity: 'success' });
    }
  };

  const handleDeleteConfirm = async () => {
    if (deleting == null) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      setSnackbar({ message: 'Warehouse deleted', severity: 'success' });
    } catch {
      setSnackbar({ message: 'Failed to delete warehouse', severity: 'error' });
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
          Warehouses
        </Typography>
        <Button onClick={openCreate} data-testid="new-warehouse">New Warehouse</Button>
      </Box>

      <Box component="form" onSubmit={search} sx={{ display: 'flex', gap: 1, maxWidth: 480 }}>
        <TextField
          size="small"
          label="Search by name"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          fullWidth
        />
        <Button type="submit" startIcon={<SearchIcon />} aria-label="Search warehouses">
          Search
        </Button>
      </Box>

      {isPending && <LinearProgress aria-label="Loading warehouses" />}

      {isError && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={() => refetch()}>
              Retry
            </Button>
          }
        >
          <AlertTitle>Failed to load warehouses</AlertTitle>
          {error instanceof Error ? error.message : 'Unknown error'}
        </Alert>
      )}

      {data != null && (
        <TableContainer component={Paper}>
          <Table aria-label="Warehouses table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Address</TableCell>
                <TableCell>Coordinates</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} align="center">
                    No warehouses found
                  </TableCell>
                </TableRow>
              )}
              {data.items.map((warehouse) => (
                <TableRow key={warehouse.id} data-testid={`warehouse-row-${warehouse.id}`}>
                  <TableCell>{warehouse.name}</TableCell>
                  <TableCell>{warehouse.address}</TableCell>
                  <TableCell>
                    {warehouse.latitude ?? '—'}
                    {' / '}
                    {warehouse.longitude ?? '—'}
                  </TableCell>
                  <TableCell>{new Date(warehouse.createdAt).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton size="small" aria-label={`Edit warehouse ${warehouse.name}`} onClick={() => openEdit(warehouse)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton size="small" aria-label={`Delete warehouse ${warehouse.name}`} onClick={() => setDeleting(warehouse)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
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

      <WarehouseFormDialog
        open={formOpen}
        warehouse={editing}
        onClose={() => setFormOpen(false)}
        onSubmit={handleFormSubmit}
      />

      <Dialog open={deleting != null} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete warehouse</DialogTitle>
        <DialogContent>
          <DialogContentText>Delete “{deleting?.name}”? This cannot be undone.</DialogContentText>
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
