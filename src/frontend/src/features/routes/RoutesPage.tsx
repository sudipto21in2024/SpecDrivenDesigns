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
  Typography,
} from '@mui/material';
import type { ListRoutesParams, RouteStatus, RouteUpdateInput } from '../../api/client';
import { ApiError } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { useDrivers } from '../drivers/hooks';
import { useVehicles } from '../vehicles/hooks';
import { useCreateRoute, useRoutes, useUpdateRoute } from './hooks';
import { routeStatusOptions } from './schema';
import RouteFormDialog from './RouteFormDialog';
import EditRouteDialog from './EditRouteDialog';
import RouteShipmentsPanel from './RouteShipmentsPanel';

/** AC-6: PATCH is Planned-only, so the row action is offered on Planned routes alone. */
const editableStatus: RouteStatus = 'Planned';

/**
 * Route list + create page (LOGI-0009 F9, AC-1..AC-10).
 *
 * A paged table with AND filters (status/vehicle/driver/q), a role-gated create dialog, and an
 * Edit affordance that covers assign / reassign / unassign on Planned routes. A Driver sees the
 * table (own routes only — the mock/server scope it) but no write affordances at all.
 */
export default function RoutesPage() {
  // MUI TablePagination is zero-based; the API is one-based (page defaults to 1, pageSize 25).
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const [searchText, setSearchText] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<RouteStatus | ''>('');
  const [vehicleFilter, setVehicleFilter] = useState('');
  const [driverFilter, setDriverFilter] = useState('');

  const { user } = useAuth();
  const canCreate = user != null && can(user.role, 'createRoutes');
  const canEdit = user != null && can(user.role, 'editRoutes');

  // Name resolution for the FK columns. A Driver is not permitted to read /drivers (spec §2), so
  // that query fails for them and the column falls back to `Driver #<id>`.
  const vehicles = useVehicles(1, 100, '', '', '');
  const drivers = useDrivers(1, 100, '', '');
  const vehicleName = useMemo(() => {
    const map = new Map<number, string>();
    for (const vehicle of vehicles.data?.items ?? []) map.set(vehicle.id, vehicle.plateNumber);
    return (id: number) => map.get(id) ?? `Vehicle #${id}`;
  }, [vehicles.data?.items]);
  const driverName = useMemo(() => {
    const map = new Map<number, string>();
    for (const driver of drivers.data?.items ?? []) map.set(driver.id, driver.fullName);
    return (id: number) => map.get(id) ?? `Driver #${id}`;
  }, [drivers.data?.items]);

  // Only supplied filters are serialized — `listRoutes` omits falsy values.
  const params: ListRoutesParams = useMemo(
    () => ({
      page: page + 1,
      pageSize: rowsPerPage,
      status: status || undefined,
      vehicleId: vehicleFilter ? Number(vehicleFilter) : undefined,
      driverId: driverFilter ? Number(driverFilter) : undefined,
      q: q || undefined,
    }),
    [page, rowsPerPage, status, vehicleFilter, driverFilter, q],
  );

  const { data, isPending, isError, error, refetch } = useRoutes(params);
  const createMutation = useCreateRoute();
  const updateMutation = useUpdateRoute();
  const [formOpen, setFormOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  /** The route whose Shipments panel is open, plus the name/status it renders in its title. */
  const [shipmentsFor, setShipmentsFor] = useState<{ id: number; name: string; status: RouteStatus } | null>(null);
  const [snackbar, setSnackbar] = useState<{ message: string; severity: 'success' | 'error' } | null>(
    null,
  );

  /**
   * AC-5/AC-6: a 409 means the route's state changed (or overlaps) elsewhere. Surface the server's
   * detail and refetch so the table shows the truth instead of a stale affordance.
   */
  const conflictMessage = (caught: unknown, fallback: string) => {
    const detail = caught instanceof ApiError ? (caught.problem.detail ?? caught.message) : fallback;
    setSnackbar({ message: detail, severity: 'error' });
    void refetch();
  };

  const handleCreate = async (input: Parameters<typeof createMutation.mutateAsync>[0]) => {
    const created = await createMutation.mutateAsync(input);
    setSnackbar({ message: `Route '${created.name}' created`, severity: 'success' });
    setFormOpen(false);
  };

  const handleUpdate = async (body: RouteUpdateInput) => {
    if (editId == null) return;
    try {
      const updated = await updateMutation.mutateAsync({ id: editId, body });
      setSnackbar({ message: `Route '${updated.name}' updated`, severity: 'success' });
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 409 || caught.status === 404)) {
        conflictMessage(caught, 'This route can no longer be modified.');
        throw caught; // re-thrown so the dialog stays open and shows the detail
      }
      throw caught; // the dialog renders field-keyed 400s and other failures
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
    setVehicleFilter('');
    setDriverFilter('');
    setPage(0);
  };

  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h2" data-testid="routes-title">
          Routes
        </Typography>
        {canCreate && (
          <Button onClick={() => setFormOpen(true)} data-testid="new-route">
            New route
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
          inputProps={{ 'aria-label': 'Search routes by name' }}
        />
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel id="route-status-filter">Status</InputLabel>
          <Select
            labelId="route-status-filter"
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as RouteStatus | '');
              setPage(0);
            }}
          >
            <MenuItem value="">All statuses</MenuItem>
            {routeStatusOptions.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="route-vehicle-filter">Vehicle</InputLabel>
          <Select
            labelId="route-vehicle-filter"
            label="Vehicle"
            value={vehicleFilter}
            onChange={(event) => {
              setVehicleFilter(event.target.value as string);
              setPage(0);
            }}
          >
            <MenuItem value="">All vehicles</MenuItem>
            {(vehicles.data?.items ?? []).map((vehicle) => (
              <MenuItem key={vehicle.id} value={String(vehicle.id)}>
                {vehicle.plateNumber}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 160 }}>
          <InputLabel id="route-driver-filter">Driver</InputLabel>
          <Select
            labelId="route-driver-filter"
            label="Driver"
            value={driverFilter}
            onChange={(event) => {
              setDriverFilter(event.target.value as string);
              setPage(0);
            }}
          >
            <MenuItem value="">All drivers</MenuItem>
            {(drivers.data?.items ?? []).map((driver) => (
              <MenuItem key={driver.id} value={String(driver.id)}>
                {driver.fullName}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button type="submit" variant="outlined" data-testid="route-search">
          Search
        </Button>
        <Button type="button" onClick={resetFilters} data-testid="route-reset">
          Reset
        </Button>
      </Box>
      {isError && (
        <Alert severity="error" sx={{ mb: 2 }} role="alert">
          Failed to load routes: {(error as Error).message}
        </Alert>
      )}

      <Paper>
        <TableContainer>
          <Table aria-label="Routes table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Planned start</TableCell>
                <TableCell>Planned end</TableCell>
                <TableCell>Vehicle</TableCell>
                <TableCell>Driver</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right" data-testid="routes-shipments-header">
                  Shipments
                </TableCell>
                {canEdit && (
                  <TableCell align="right" data-testid="routes-actions-header">
                    Actions
                  </TableCell>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {isPending && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 8 : 7} align="center">
                    Loading routes…
                  </TableCell>
                </TableRow>
              )}
              {data != null && data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={canEdit ? 8 : 7} align="center">
                    No routes found
                  </TableCell>
                </TableRow>
              )}
              {(data?.items ?? []).map((route) => (
                <TableRow key={route.id} hover data-testid={`route-row-${route.id}`}>
                  <TableCell>{route.name}</TableCell>
                  <TableCell>{route.plannedStart}</TableCell>
                  <TableCell>{route.plannedEnd}</TableCell>
                  <TableCell>
                    {route.vehicleId == null ? 'Unassigned' : vehicleName(route.vehicleId)}
                  </TableCell>
                  <TableCell>
                    {route.driverId == null ? 'Unassigned' : driverName(route.driverId)}
                  </TableCell>
                  <TableCell>{route.status}</TableCell>
                  {/* LOGI-0010 AC-7: the panel is readable by every role that may read routes, so
                      the affordance sits outside the canEdit column (which is write-gated). */}
                  <TableCell align="right">
                    <Button
                      size="small"
                      aria-label={`Shipments on ${route.name}`}
                      onClick={() => setShipmentsFor({ id: route.id, name: route.name, status: route.status })}
                      data-testid={`route-shipments-${route.id}`}
                    >
                      Shipments
                    </Button>
                  </TableCell>
                  {canEdit && (
                    <TableCell align="right">
                      {/* AC-6: the API rejects a non-Planned PATCH with 409, so the affordance
                          is offered on Planned routes alone. */}
                      {route.status === editableStatus && (
                        <Button
                          size="small"
                          aria-label={`Edit ${route.name}`}
                          onClick={() => setEditId(route.id)}
                        >
                          Edit
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data != null && (
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
        )}
      </Paper>
      {canCreate && (
        <RouteFormDialog
          open={formOpen}
          onClose={() => setFormOpen(false)}
          onSubmit={handleCreate}
        />
      )}

      {canEdit && (
        <EditRouteDialog
          open={editId != null}
          routeId={editId}
          onClose={() => setEditId(null)}
          onSubmit={handleUpdate}
        />
      )}

      <Snackbar
        open={snackbar != null}
        autoHideDuration={4000}
        onClose={() => setSnackbar(null)}
        message={snackbar?.message}
        data-testid="snackbar"
      />

      {/* LOGI-0010: the route-scoped shipments panel, mounted for every role that can read it. */}
      <RouteShipmentsPanel
        open={shipmentsFor != null}
        routeId={shipmentsFor?.id ?? null}
        routeName={shipmentsFor?.name ?? ''}
        routeStatus={shipmentsFor?.status ?? null}
        onClose={() => setShipmentsFor(null)}
      />
    </Box>
  );
}
