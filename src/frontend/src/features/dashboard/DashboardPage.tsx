import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  Grid,
  InputLabel,
  Link,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { ApiError } from '../../api/client';
import type { DashboardResponse, DriverUtilization, VehicleUtilization } from '../../api/client';
import StatusTile from './StatusTile';
import { useDashboard } from './hooks';
import {
  DASHBOARD_PRIORITY_OPTIONS,
  DASHBOARD_STATUSES,
  DEFAULT_AT_RISK_PAGE_SIZE,
  DRIVER_STATUS_ORDER,
  EMPTY_DASHBOARD_FILTERS,
  VEHICLE_STATUS_ORDER,
  atRiskTotal,
  countForStatus,
  driverListHref,
  formatMinutesToDue,
  formatUtilizationPercent,
  hasActiveFilters,
  isOverdue,
  nextAtRiskPage,
  previousAtRiskPage,
  shipmentListHref,
  utilizationBuckets,
  vehicleListHref,
} from './schema';
import type { DashboardFilterState } from './schema';

/**
 * The composable filter bar (AC-6).
 *
 * Every control maps to a query parameter on the ONE dashboard request, and every one of those params is
 * ALSO a `GET /shipments` filter — the dashboard deliberately defines no filter vocabulary of its own.
 * That is what makes the drill-down links meaningful: a filtered tile and the list it opens are asking
 * the same server the same question.
 */
function DashboardFilters({
  filters,
  onChange,
  onClear,
}: {
  filters: DashboardFilterState;
  onChange: (next: DashboardFilterState) => void;
  onClear: () => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="dashboard-filters">
      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <FormControl size="small" fullWidth>
            <InputLabel id="dashboard-status-label">Status</InputLabel>
            {/*
              The testid goes on the Select ROOT (the rendered div), not on its inner input: MUI's select
              input carries `pointer-events: none`, so a test targeting the input cannot click it. This
              mirrors the planning-board filter bar for the same reason.
            */}
            <Select
              labelId="dashboard-status-label"
              label="Status"
              value={filters.status ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  status: (e.target.value || undefined) as DashboardFilterState['status'],
                })
              }
              data-testid="filter-status"
            >
              <MenuItem value="">All statuses</MenuItem>
              {DASHBOARD_STATUSES.map((status) => (
                <MenuItem key={status} value={status}>
                  {status}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={3}>
          <FormControl size="small" fullWidth>
            <InputLabel id="dashboard-priority-label">Priority</InputLabel>
            <Select
              labelId="dashboard-priority-label"
              label="Priority"
              value={filters.priority ?? ''}
              onChange={(e) =>
                onChange({
                  ...filters,
                  priority: (e.target.value || undefined) as DashboardFilterState['priority'],
                })
              }
              data-testid="filter-priority"
            >
              <MenuItem value="">All priorities</MenuItem>
              {DASHBOARD_PRIORITY_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {option}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField
            fullWidth
            size="small"
            label="Origin warehouse id"
            type="number"
            value={filters.originWarehouseId ?? ''}
            onChange={(e) =>
              onChange({
                ...filters,
                originWarehouseId: e.target.value === '' ? undefined : Number(e.target.value),
              })
            }
            inputProps={{ 'data-testid': 'filter-origin-warehouse' }}
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField
            fullWidth
            size="small"
            label="Route id"
            type="number"
            value={filters.routeId ?? ''}
            onChange={(e) =>
              onChange({ ...filters, routeId: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            inputProps={{ 'data-testid': 'filter-route' }}
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <Button onClick={onClear} disabled={!hasActiveFilters(filters)} data-testid="filter-clear">
            Clear filters
          </Button>
        </Grid>
      </Grid>
    </Paper>
  );
}

/**
 * AC-2/AC-3: the SLA-at-risk list and its pager.
 *
 * The rows are rendered exactly as the server returned them — no client-side re-sorting and no
 * re-derivation of "at risk". Either would risk disagreeing with the tile beside it, which shows the
 * same instant's total (AC-3). The pager's count and the tile's count are the same number by construction.
 */
function AtRiskList({
  dashboard,
  onPage,
}: {
  dashboard: DashboardResponse;
  onPage: (page: number) => void;
}) {
  const page = dashboard.atRiskShipments;
  const next = nextAtRiskPage(dashboard);
  const previous = previousAtRiskPage(dashboard);

  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid="at-risk-panel">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" component="h3">
          SLA at risk
        </Typography>
        <Chip size="small" label={dashboard.atRiskTotalCount} data-testid="at-risk-count" />
      </Stack>

      {page.items.length === 0 ? (
        <Typography variant="caption" color="text.secondary" data-testid="at-risk-empty">
          No shipments at risk for this selection.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Reference</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Priority</TableCell>
              <TableCell>SLA due</TableCell>
              <TableCell align="right">Time to due</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {page.items.map((row) => (
              <TableRow
                key={row.id}
                data-testid={`at-risk-row-${row.id}`}
                sx={isOverdue(row) ? { color: 'error.main' } : undefined}
              >
                <TableCell>{row.referenceCode}</TableCell>
                <TableCell>{row.status}</TableCell>
                <TableCell>{row.priority}</TableCell>
                <TableCell>{row.slaDueAt ?? '—'}</TableCell>
                <TableCell align="right">{formatMinutesToDue(row.minutesToDue)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
        <Button
          size="small"
          disabled={previous == null}
          data-testid="at-risk-prev"
          onClick={() => previous != null && onPage(previous)}
        >
          Previous
        </Button>
        <Typography variant="caption" data-testid="at-risk-page">
          {`Page ${page.page} of ${page.totalPages || 1} · ${page.totalCount} total`}
        </Typography>
        <Button
          size="small"
          disabled={next == null}
          data-testid="at-risk-next"
          onClick={() => next != null && onPage(next)}
        >
          Next
        </Button>
      </Stack>
    </Paper>
  );
}/**
 * One utilization panel (AC-4/AC-5).
 *
 * The buckets come off the dashboard response — NOT from a separate `/vehicles` or `/drivers` read. A
 * second read would put the panel on a different instant from the tiles, which is exactly the drift
 * `generatedAt` exists to eliminate (AC-3).
 *
 * The percentage renders as an em dash when the API reports null, because null means "there is no
 * capacity at all", which is a different statement from "0% of capacity is used" (AC-4/AC-5).
 */
function UtilizationPanel({
  testId,
  title,
  utilization,
  order,
  hrefFor,
  onNavigate,
  capacity,
}: {
  testId: string;
  title: string;
  utilization: VehicleUtilization | DriverUtilization;
  order: readonly string[];
  hrefFor: (status: string) => string;
  onNavigate: (href: string) => void;
  capacity?: { label: string; inUse: number; total: number };
}) {
  const percent =
    capacity != null ? utilization.capacityUtilizationPercent : utilization.utilizationPercent;
  return (
    <Paper variant="outlined" sx={{ p: 2 }} data-testid={testId}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Typography variant="subtitle1" component="h3">
          {title}
        </Typography>
        <Chip size="small" label={utilization.totalCount} data-testid={`${testId}-total`} />
      </Stack>

      <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: 'wrap', mb: 1 }}>
        {utilizationBuckets(utilization, order).map((bucket) => (
          <Link
            key={bucket.status}
            underline="hover"
            data-testid={`${testId}-bucket-${bucket.status}`}
            href={hrefFor(bucket.status)}
            onClick={(event) => {
              event.preventDefault();
              onNavigate(hrefFor(bucket.status));
            }}
          >
            {`${bucket.status}: ${bucket.count}`}
          </Link>
        ))}
      </Stack>

      <Typography
        variant="body2"
        data-testid={`${testId}-percent`}
        title={percent == null ? 'No capacity recorded, so there is no share to report.' : undefined}
      >
        {`${capacity?.label ?? 'Active share'}: ${formatUtilizationPercent(percent)}`}
      </Typography>
      {capacity != null && (
        <Typography variant="caption" color="text.secondary" data-testid={`${testId}-capacity`}>
          {`${capacity.inUse} kg in use of ${capacity.total} kg total capacity`}
        </Typography>
      )}
    </Paper>
  );
}/**
 * The manager's operations dashboard (LOGI-0012) — a read-only aggregate over
 * `GET /api/v1/dashboard`.
 *
 * ONE request renders the whole screen: the six status tiles, the SLA-at-risk list and the two
 * utilization panels. That is not an efficiency choice but a correctness one — the API evaluated
 * everything at a single captured instant (`generatedAt`), and any second read (a `/vehicles` fetch
 * for the fleet panel, say) would put part of the screen on a different `now`. AC-3's promise that the
 * tile and the list cannot disagree is only true end-to-end if the client does not re-introduce the
 * skew the server removed.
 *
 * Read-only by construction: the only controls are filters, paging and drill-down navigation. Nothing
 * here mutates, because persisting any of these projections would violate BR-2 rule 2.5 (spec §7 O2).
 */
export default function DashboardPage({
  onNavigate = () => undefined,
}: {
  /** Injected so tests can assert the drill-down target; the SPA shell supplies real navigation. */
  onNavigate?: (href: string) => void;
}) {
  const [filters, setFilters] = useState<DashboardFilterState>(EMPTY_DASHBOARD_FILTERS);
  const [page, setPage] = useState(1);

  // The page is deliberately NOT reset by a filter change: a manager who paged to the third screen of
  // at-risk rows still wants to see the third screen after narrowing by priority.
  const params = useMemo(
    () => ({ ...filters, page, pageSize: DEFAULT_AT_RISK_PAGE_SIZE }),
    [filters, page],
  );
  const { data: dashboard, isPending, isError, error } = useDashboard(params);

  const errorDetail =
    error instanceof ApiError
      ? (error.problem.detail ?? error.message)
      : 'Unable to load the dashboard.';

  return (
    <Box data-testid="dashboard">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h2">
          Operations dashboard
        </Typography>
        {dashboard != null && (
          <Typography variant="caption" color="text.secondary" data-testid="dashboard-generated-at">
            {`As of ${dashboard.generatedAt}`}
          </Typography>
        )}
      </Stack>

      <DashboardFilters
        filters={filters}
        onChange={setFilters}
        onClear={() => setFilters(EMPTY_DASHBOARD_FILTERS)}
      />

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="dashboard-error">
          {errorDetail}
        </Alert>
      )}

      {isPending && dashboard == null && (
        <Stack alignItems="center" sx={{ my: 4 }} data-testid="dashboard-loading">
          <CircularProgress size={28} />
        </Stack>
      )}

      {dashboard != null && (
        <Stack spacing={2}>
          <Grid container spacing={2}>
            {DASHBOARD_STATUSES.map((status) => (
              <Grid item xs={6} sm={4} md={2} key={status}>
                <StatusTile
                  label={status}
                  testId={status}
                  count={countForStatus(dashboard, status)}
                  href={shipmentListHref(status, filters)}
                  onNavigate={onNavigate}
                />
              </Grid>
            ))}
            <Grid item xs={6} sm={4} md={2}>
              {/* AC-3: this tile shows `atRiskTotalCount`, the same number the pager carries — never
                  `items.length`, which would show the page size as if it were the total. */}
              <StatusTile
                label="SLA at risk"
                testId="at-risk"
                count={atRiskTotal(dashboard)}
                href={shipmentListHref('at-risk', filters)}
                onNavigate={onNavigate}
              />
            </Grid>
          </Grid>

          <AtRiskList dashboard={dashboard} onPage={setPage} />

          <Grid container spacing={2}>
            <Grid item xs={12} md={6}>
              <UtilizationPanel
                testId="vehicle-utilization"
                title="Fleet utilization"
                utilization={dashboard.vehicleUtilization}
                order={VEHICLE_STATUS_ORDER}
                hrefFor={vehicleListHref}
                onNavigate={onNavigate}
                capacity={{
                  label: 'Capacity in use',
                  inUse: dashboard.vehicleUtilization.inUseCapacityKg,
                  total: dashboard.vehicleUtilization.totalCapacityKg,
                }}
              />
            </Grid>
            <Grid item xs={12} md={6}>
              <UtilizationPanel
                testId="driver-utilization"
                title="Driver pool"
                utilization={dashboard.driverUtilization}
                order={DRIVER_STATUS_ORDER}
                hrefFor={driverListHref}
                onNavigate={onNavigate}
              />
            </Grid>
          </Grid>
        </Stack>
      )}
    </Box>
  );
}