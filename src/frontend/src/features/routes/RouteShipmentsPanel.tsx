import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material';
import { ApiError } from '../../api/client';
import type { RouteCapacityView } from '../../api/client';
import { useAuth } from '../auth/AuthContext';
import { can } from '../auth/permissions';
import { useShipments } from '../shipments/hooks';
import { useAssignShipmentToRoute, useRemoveShipmentFromRoute, useRouteShipments } from './hooks';

interface RouteShipmentsPanelProps {
  open: boolean;
  /** The route whose shipments are managed; null while the panel is closed. */
  routeId: number | null;
  /** Route display name, for the dialog title. */
  routeName: string;
  /** Route status, because assign/unassign are Planned-only server-side (AC-3). */
  routeStatus: string | null;
  onClose: () => void;
}

/** AC-3: the server only accepts assignment on a Planned route, so the UI matches it exactly. */
const ASSIGNABLE_STATUS = 'Planned';

/**
 * Renders the BR-5 capacity projection (AC-8).
 *
 * A route with no vehicle reports null capacityKg/remainingCapacityKg, and that is rendered as an
 * explicit "capacity not checked" state rather than as 0 — 0 kg remaining would read as a full
 * truck and is exactly the confusion the contract's nulls exist to prevent (AC-2).
 */
function CapacityBanner({ capacity }: { capacity: RouteCapacityView | undefined }) {
  if (capacity == null) return null;

  const unknownCapacity = capacity.capacityKg == null;
  const percentUsed =
    unknownCapacity || capacity.capacityKg == null || capacity.capacityKg === 0
      ? 0
      : Math.min(100, (capacity.assignedWeightKg / capacity.capacityKg) * 100);

  return (
    <Box sx={{ mb: 2 }} data-testid="capacity-banner">
      <Typography variant="subtitle1" component="h3" data-testid="capacity-summary">
        {`${capacity.assignedWeightKg} kg assigned across ${capacity.shipmentCount} shipment${
          capacity.shipmentCount === 1 ? '' : 's'
        }`}
      </Typography>
      {unknownCapacity ? (
        <Typography variant="body2" color="text.secondary" data-testid="capacity-unknown">
          No vehicle assigned — capacity is not checked for this route.
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" data-testid="capacity-numbers">
            {`${capacity.remainingCapacityKg} kg remaining of ${capacity.capacityKg} kg capacity`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={percentUsed}
            aria-label="Capacity used"
            sx={{ mt: 1 }}
          />
        </>
      )}
    </Box>
  );
}

/**
 * Route shipments panel (LOGI-0010 AC-1..AC-9): a route-scoped dialog showing the BR-5 capacity
 * projection, the paged list of assigned shipments, and — for Admin/Dispatcher on a Planned
 * route — the assign and unassign affordances.
 *
 * Two deliberate behaviours:
 *
 * 1. Errors are surfaced from `ApiError.problem.detail` verbatim. Spec §7 O1 made capacity and
 *    status violations 409 rather than 400, so the panel must not assume "400 = field, 409 =
 *    global" — one Alert handles every non-2xx, and the capacity 409 arrives already carrying the
 *    assigned / adding / capacity numbers the operator needs (AC-2).
 * 2. Candidate shipments are filtered client-side from the existing `GET /shipments` read (no new
 *    endpoint, spec §5). That is a convenience, not the authority: AC-4's 409 is what actually
 *    stops a double assignment, and a shipment assigned to another route between our read and our
 *    POST is rejected server-side.
 */
export default function RouteShipmentsPanel({
  open,
  routeId,
  routeName,
  routeStatus,
  onClose,
}: RouteShipmentsPanelProps) {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [candidateId, setCandidateId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { user } = useAuth();
  const canWrite = user != null && can(user.role, 'assignRouteShipments');
  const assignable = canWrite && routeStatus === ASSIGNABLE_STATUS;

  const params = useMemo(() => ({ page: page + 1, pageSize: rowsPerPage }), [page, rowsPerPage]);
  const enabled = open && routeId != null;
  const assigned = useRouteShipments(routeId ?? 0, params, enabled);

  // Candidates: Pending and not on any route, from the existing GET /shipments read (spec §5 adds
  // no new endpoint). The read is unconditional — `useShipments` exposes no `enabled` gate — but
  // `assignable` still decides whether any control is rendered, so a Viewer/Driver sees a
  // read-only panel regardless of what this query fetched.
  const candidateParams = useMemo(() => ({ page: 1, pageSize: 100, status: 'Pending' as const }), []);
  const candidates = useShipments(candidateParams);
  const candidateOptions = (candidates.data?.items ?? []).filter((s) => s.routeId == null);

  const assignMutation = useAssignShipmentToRoute();
  const removeMutation = useRemoveShipmentFromRoute();

  const describe = (caught: unknown, fallback: string) =>
    caught instanceof ApiError ? (caught.problem.detail ?? caught.message) : fallback;

  const handleAssign = async () => {
    if (routeId == null || candidateId === '') {
      setError('Choose a shipment to assign.');
      return;
    }
    setError(null);
    try {
      // The 200 body is the authoritative read-back; the invalidated list re-reads regardless, so
      // the value itself is not needed here.
      await assignMutation.mutateAsync({ routeId, body: { shipmentId: Number(candidateId) } });
      setCandidateId('');
    } catch (caught) {
      setError(describe(caught, 'The shipment could not be assigned to this route.'));
    }
  };

  const handleUnassign = async (shipmentId: number) => {
    if (routeId == null) return;
    setError(null);
    try {
      await removeMutation.mutateAsync({ routeId, shipmentId });
    } catch (caught) {
      setError(describe(caught, 'The shipment could not be removed from this route.'));
    }
  };

  const items = assigned.data?.items ?? [];
  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth data-testid="route-shipments-panel">
      <DialogTitle data-testid="route-shipments-title">{`Shipments on ${routeName}`}</DialogTitle>
      <DialogContent dividers>
        {assigned.isError && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert" data-testid="route-shipments-error">
            {describe(assigned.error, 'The route shipments could not be loaded.')}
          </Alert>
        )}
        {error != null && (
          <Alert severity="error" sx={{ mb: 2 }} role="alert" data-testid="panel-error">
            {error}
          </Alert>
        )}
        {canWrite && routeStatus !== ASSIGNABLE_STATUS && (
          <Alert severity="info" sx={{ mb: 2 }} data-testid="panel-readonly-reason">
            {`A route in status '${routeStatus ?? 'unknown'}' cannot take new shipments — assignment requires 'Planned'.`}
          </Alert>
        )}

        <CapacityBanner capacity={assigned.data?.capacity} />

        {assignable && (
          <Stack direction="row" spacing={1} sx={{ mb: 2 }} alignItems="center">
            <FormControl size="small" sx={{ minWidth: 260 }}>
              <InputLabel id="assign-candidate-label">Shipment to assign</InputLabel>
              <Select
                labelId="assign-candidate-label"
                label="Shipment to assign"
                value={candidateId}
                onChange={(event) => setCandidateId(event.target.value)}
                inputProps={{ 'aria-label': 'Shipment to assign' }}
              >
                {candidateOptions.length === 0 && (
                  <MenuItem value="">No pending shipments available</MenuItem>
                )}
                {candidateOptions.map((shipment) => (
                  <MenuItem key={shipment.id} value={String(shipment.id)}>
                    {`${shipment.referenceCode} — ${shipment.weightKg} kg`}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Button
              variant="contained"
              onClick={handleAssign}
              disabled={assignMutation.isPending || candidateId === ''}
              data-testid="assign-shipment"
            >
              Assign
            </Button>
          </Stack>
        )}

        <TableContainer>
          <Table aria-label="Route shipments table" size="small">
            <TableHead>
              <TableRow>
                <TableCell>Reference</TableCell>
                <TableCell>Destination</TableCell>
                <TableCell>Weight (kg)</TableCell>
                <TableCell>Status</TableCell>
                {assignable && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {assigned.isPending && (
                <TableRow>
                  <TableCell colSpan={assignable ? 5 : 4} align="center">
                    Loading shipments…
                  </TableCell>
                </TableRow>
              )}
              {!assigned.isPending && items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={assignable ? 5 : 4} align="center" data-testid="route-shipments-empty">
                    No shipments assigned to this route yet
                  </TableCell>
                </TableRow>
              )}
              {items.map((shipment) => (
                <TableRow key={shipment.id} data-testid={`route-shipment-${shipment.id}`}>
                  <TableCell>{shipment.referenceCode}</TableCell>
                  <TableCell>{shipment.destinationAddress}</TableCell>
                  <TableCell>{shipment.weightKg}</TableCell>
                  <TableCell data-testid={`route-shipment-status-${shipment.id}`}>{shipment.status}</TableCell>
                  {assignable && (
                    <TableCell align="right">
                      <Button
                        size="small"
                        aria-label={`Remove ${shipment.referenceCode} from route`}
                        onClick={() => void handleUnassign(shipment.id)}
                        disabled={removeMutation.isPending}
                        data-testid={`unassign-shipment-${shipment.id}`}
                      >
                        Unassign
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {assigned.data != null && (
          <TablePagination
            component="div"
            count={assigned.data.totalCount}
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
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} data-testid="close-route-shipments">
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
