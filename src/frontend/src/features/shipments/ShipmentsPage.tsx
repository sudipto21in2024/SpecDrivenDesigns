import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  FormControl,
  InputLabel,
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
import { SearchIcon } from '../../components/icons';
import type {
  ListShipmentsParams,
  ShipmentPriority,
  ShipmentSort,
  ShipmentStatus,
} from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { useWarehouses } from '../warehouses/hooks';
import { useCreateShipment, useCancelShipment, useShipments, useUpdateShipment } from './hooks';
import {
  shipmentPriorities,
  shipmentSortOptions,
  shipmentStatusOptions,
} from './schema';
import ShipmentFormDialog from './ShipmentFormDialog';
import EditShipmentDialog from './EditShipmentDialog';
import CancelShipmentDialog from './CancelShipmentDialog';
import { ApiError } from '../../api/client';
import type { Shipment, ShipmentInput, ShipmentUpdateInput } from '../../api/client';

/** BR-7: a shipment may be cancelled from Pending or Assigned only (AC-8/AC-11). */
const cancellableStatuses: readonly ShipmentStatus[] = ['Pending', 'Assigned'];

/**
 * Shipment list + create page (LOGI-0007 F5/F8, AC-1..AC-10; LOGI-0008 F6, AC-11). Paged table with
 * AND filters, 4 sorts, a read-time at-risk chip, a role-gated create dialog, and the row actions
 * this ticket adds: Edit (Pending only) and Cancel (Pending/Assigned), both role-gated to
 * Admin/Dispatcher, with a 409 on either surfacing a message and refreshing the row.
 */
export default function ShipmentsPage() {
  // MUI TablePagination is zero-based; the API is one-based (page defaults to 1, pageSize 25).
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<ShipmentStatus | ''>('');
  const [priority, setPriority] = useState<ShipmentPriority | ''>('');
  const [originWarehouseId, setOriginWarehouseId] = useState('');
  const [slaRisk, setSlaRisk] = useState('');
  const [sort, setSort] = useState<ShipmentSort>('-createdAt');

  const { user } = useAuth();
  const canCreate = user != null && can(user.role, 'createShipments');
  // LOGI-0008 AC-11: Edit is the PATCH capability, Cancel is the BR-6 role rule for the
  // Cancelled transition — two separate capabilities, so neither implies the other.
  const canEdit = user != null && can(user.role, 'editShipments');
  const canCancel = user != null && can(user.role, 'cancelShipments');
  /** Viewer and Driver see no row actions at all (AC-11). */
  const showRowActions = canEdit || canCancel;

  const warehouses = useWarehouses(1, 200, '');
  const warehouseName = useMemo(() => {
    const map = new Map<number, string>();
    for (const warehouse of warehouses.data?.items ?? []) map.set(warehouse.id, warehouse.name);
    return (id: number) => map.get(id) ?? `warehouse #${id}`;
  }, [warehouses.data?.items]);

  // Only supplied filters are serialized — `listShipments` omits falsy values.
  const params: ListShipmentsParams = useMemo(
    () => ({
      page: page + 1,
      pageSize: rowsPerPage,
      status: status || undefined,
      priority: priority || undefined,
      originWarehouseId: originWarehouseId ? Number(originWarehouseId) : undefined,
      slaRisk: slaRisk === 'true' || slaRisk === 'false' ? slaRisk === 'true' : undefined,
      q: q || undefined,
      sort,
    }),
    [page, rowsPerPage, q, status, priority, originWarehouseId, slaRisk, sort],
  );

  const { data, isPending, isError, error, refetch } = useShipments(params);
  const createMutation = useCreateShipment();
  const updateMutation = useUpdateShipment();
  const cancelMutation = useCancelShipment();
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<Shipment | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(null);

  /**
   * AC-11: a 409 means the row's state changed in another tab. Surface the server's detail and
   * refetch so the table shows the truth instead of a stale affordance.
   */
  const conflictMessage = (caught: unknown, fallback: string) => {
    const detail = caught instanceof ApiError ? (caught.problem.detail ?? caught.message) : fallback;
    setSnackbar({ message: detail, severity: 'error' });
    void refetch();
  };

  const handleUpdate = async (body: ShipmentUpdateInput) => {
    if (editId == null) return;
    try {
      const updated = await updateMutation.mutateAsync({ id: editId, body });
      setSnackbar({ message: `Shipment ${updated.referenceCode} updated`, severity: 'success' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        conflictMessage(caught, 'This shipment can no longer be edited.');
        throw caught; // re-thrown so the dialog stays open and shows the detail (AC-11)
      }
      throw caught; // the dialog renders field-keyed 400s and other failures
    }
  };

  const handleCancel = async (note?: string) => {
    if (cancelTarget == null) return;
    const { referenceCode } = cancelTarget;
    try {
      await cancelMutation.mutateAsync({ id: cancelTarget.id, note });
      setSnackbar({ message: `Shipment ${referenceCode} cancelled`, severity: 'success' });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) {
        conflictMessage(caught, 'This shipment can no longer be cancelled.');
        return;
      }
      // 403/404/400 are shown inside the dialog, which stays open.
      throw caught;
    }
  };

  const applySearch = (event: React.FormEvent) => {
    event.preventDefault();
    setQ(searchText.trim());
    setPage(0);
  };
  const resetFilters = () => {
    setSearchText('');
    setQ('');
    setStatus('');
    setPriority('');
    setOriginWarehouseId('');
    setSlaRisk('');
    setSort('-createdAt');
    setPage(0);
  };

  const handleCreate = async (input: ShipmentInput) => {
    const created = await createMutation.mutateAsync(input);
    setSnackbar({ message: `Shipment ${created.referenceCode} created`, severity: 'success' });
    setFormOpen(false);
  };

    return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h2" data-testid="shipments-title">
          Shipments
        </Typography>
        {canCreate && (
          <Button onClick={() => setFormOpen(true)} data-testid="new-shipment">
            New shipment
          </Button>
        )}
      </Stack>

      <Box
        component="form"
        onSubmit={applySearch}
        sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap', mb: 2 }}
      >
        <TextField
          size="small"
          label="Search"
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          inputProps={{ 'aria-label': 'Search shipments by reference or destination' }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel id="shipment-status-filter">Status</InputLabel>
          <Select
            labelId="shipment-status-filter"
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ShipmentStatus | '');
              setPage(0);
            }}
            inputProps={{ 'aria-label': 'Filter by status' }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {shipmentStatusOptions.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="shipment-priority-filter">Priority</InputLabel>
          <Select
            labelId="shipment-priority-filter"
            label="Priority"
            value={priority}
            onChange={(event) => {
              setPriority(event.target.value as ShipmentPriority | '');
              setPage(0);
            }}
            inputProps={{ 'aria-label': 'Filter by priority' }}
          >
            <MenuItem value="">All priorities</MenuItem>
            {shipmentPriorities.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel id="shipment-origin-filter">Origin warehouse</InputLabel>
          <Select
            labelId="shipment-origin-filter"
            label="Origin warehouse"
            value={originWarehouseId}
            onChange={(event) => {
              setOriginWarehouseId(event.target.value);
              setPage(0);
            }}
            inputProps={{ 'aria-label': 'Filter by origin warehouse' }}
          >
            <MenuItem value="">All origins</MenuItem>
            {(warehouses.data?.items ?? []).map((warehouse) => (
              <MenuItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="shipment-slarisk-filter">SLA risk</InputLabel>
          <Select
            labelId="shipment-slarisk-filter"
            label="SLA risk"
            value={slaRisk}
            onChange={(event) => {
              setSlaRisk(event.target.value);
              setPage(0);
            }}
            inputProps={{ 'aria-label': 'Filter by SLA risk' }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="true">At risk</MenuItem>
            <MenuItem value="false">OK</MenuItem>
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="shipment-sort-filter">Sort</InputLabel>
          <Select
            labelId="shipment-sort-filter"
            label="Sort"
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as ShipmentSort);
              setPage(0);
            }}
            inputProps={{ 'aria-label': 'Sort shipments' }}
          >
            {shipmentSortOptions.map((option) => (
              <MenuItem key={option} value={option}>
                {option === '-createdAt'
                  ? 'Newest first'
                  : option === 'createdAt'
                  ? 'Oldest first'
                  : option === 'slaDueAt'
                  ? 'Due ascending'
                  : 'Due descending'}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button type="submit" variant="outlined" startIcon={<SearchIcon />} aria-label="Apply filters">
          Search
        </Button>
        <Button type="button" variant="text" onClick={resetFilters} aria-label="Reset filters">
          Clear
        </Button>
      </Box>

            {isPending && <Typography data-testid="loading">Loading shipments…</Typography>}
      {isError && (
        <Alert severity="error" action={<Button onClick={() => refetch()}>Retry</Button>}>
          Failed to load shipments: {(error as Error).message}
        </Alert>
      )}

      {data != null && (
        <Paper>
          <TableContainer>
            <Table aria-label="Shipments table">
              <TableHead>
                <TableRow>
                  <TableCell>Reference</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Priority</TableCell>
                  <TableCell>Origin</TableCell>
                  <TableCell>Destination</TableCell>
                  <TableCell align="right">Weight (kg)</TableCell>
                  <TableCell>SLA due</TableCell>
                  <TableCell>At risk</TableCell>
                  <TableCell>Created</TableCell>
                  {showRowActions && <TableCell align="right">Actions</TableCell>}
                </TableRow>
              </TableHead>
              <TableBody>
                {data.items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={showRowActions ? 10 : 9} align="center">
                      No shipments found
                    </TableCell>
                  </TableRow>
                )}
                {data.items.map((shipment) => (
                  <TableRow key={shipment.id} hover>
                    <TableCell>{shipment.referenceCode}</TableCell>
                    <TableCell>{shipment.status}</TableCell>
                    <TableCell>{shipment.priority}</TableCell>
                    <TableCell>{warehouseName(shipment.originWarehouseId)}</TableCell>
                    <TableCell>{shipment.destinationAddress}</TableCell>
                    <TableCell align="right">{shipment.weightKg}</TableCell>
                    <TableCell>{shipment.slaDueAt ?? '—'}</TableCell>
                    <TableCell>
                      {shipment.atRisk && shipment.slaDueAt != null ? (
                        <Tooltip title="At risk of breaching SLA">
                          <Box component="span" sx={{ color: 'error.main', fontWeight: 700 }}>
                            At risk
                          </Box>
                        </Tooltip>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                    <TableCell>{shipment.createdAt}</TableCell>
                    {showRowActions && (
                      <TableCell align="right">
                        {/* AC-11: Edit is Pending-only; Cancel is legal from Pending or Assigned. */}
                        {canEdit && shipment.status === 'Pending' && (
                          <Button
                            size="small"
                            onClick={() => setEditId(shipment.id)}
                            aria-label={`Edit ${shipment.referenceCode}`}
                          >
                            Edit
                          </Button>
                        )}
                        {canCancel && cancellableStatuses.includes(shipment.status) && (
                          <Button
                            size="small"
                            color="error"
                            onClick={() => setCancelTarget(shipment)}
                            aria-label={`Cancel ${shipment.referenceCode}`}
                          >
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <TablePagination
            component="div"
            count={data.totalCount}
            page={page}
            rowsPerPage={rowsPerPage}
            rowsPerPageOptions={[5, 10, 25, 50]}
            onPageChange={(_, next) => setPage(next)}
            onRowsPerPageChange={(event) => {
              setRowsPerPage(Number(event.target.value));
              setPage(0);
            }}
          />
        </Paper>
      )}

      {canCreate && (
        <ShipmentFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {canEdit && (
        <EditShipmentDialog
          open={editId != null}
          shipmentId={editId}
          onClose={() => setEditId(null)}
          onSubmit={handleUpdate}
        />
      )}

      {canCancel && (
        <CancelShipmentDialog
          open={cancelTarget != null}
          shipment={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onConfirm={handleCancel}
        />
      )}

      <Snackbar
        open={snackbar != null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar?.message}
        data-testid="snackbar"
      />
    </Box>
  );
}

