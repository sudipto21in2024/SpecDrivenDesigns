import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { ApiError } from '../../api/client';
import type { BoardColumn, GetPlanningBoardParams, PlanningBoardResponse } from '../../api/client';
import { RouteBoardCard, ShipmentBoardCard } from './BoardCard';
import { usePlanningBoard } from './hooks';
import {
  BOARD_PRIORITY_OPTIONS,
  BOARD_SORT_OPTIONS,
  BOARD_STATUSES,
  DEFAULT_MAX_PER_COLUMN,
  EMPTY_FILTERS,
  flattenBoard,
  hasActiveFilters,
  isTerminalStatus,
  nextMaxPerColumn,
  orderColumns,
  sortLabel,
} from './schema';
import type { BoardFilterState, BoardSort } from './schema';

/** The two presentations of the SAME response (AC-2) — never two different reads. */
type BoardView = 'kanban' | 'list';

/**
 * AC-1/AC-2: one kanban column.
 *
 * The header always shows `totalCount`, the UNTRUNCATED count, never `cards.length` — otherwise a
 * truncated column would silently read "50 of 312" as "50" (AC-8). "Load more" raises `maxPerColumn`
 * because the endpoint has no per-column cursor, and it disappears once the column is fully loaded.
 */
function KanbanColumn({
  column,
  maxPerColumn,
  onLoadMore,
}: {
  column: BoardColumn;
  maxPerColumn: number;
  onLoadMore: (next: number) => void;
}) {
  const next = nextMaxPerColumn(column, maxPerColumn);
  return (
    <Paper
      variant="outlined"
      data-testid={`board-column-${column.status}`}
      sx={{ p: 1, minWidth: 240, flex: '0 0 260px' }}
    >
      <Stack spacing={1}>
        <Stack direction="row" justifyContent="space-between" alignItems="center">
          <Typography variant="subtitle1" component="h3" data-testid={`board-column-title-${column.status}`}>
            {column.status}
          </Typography>
          <Chip size="small" label={column.totalCount} data-testid={`board-column-count-${column.status}`} />
        </Stack>
        {column.cards.length === 0 ? (
          <Typography variant="caption" color="text.secondary" data-testid={`board-column-empty-${column.status}`}>
            Nothing in this status
          </Typography>
        ) : (
          column.cards.map((card) => <ShipmentBoardCard key={card.id} card={card} />)
        )}
        {next != null && (
          <Button size="small" data-testid={`board-load-more-${column.status}`} onClick={() => onLoadMore(next)}>
            {`Load more (${column.totalCount - column.cards.length} more)`}
          </Button>
        )}
      </Stack>
    </Paper>
  );
}

/**
 * The composable filter bar (AC-3).
 *
 * Every control maps to a query parameter on the ONE board request — there is no client-side
 * fetch-and-filter over an unpaged list (spec §5). Clearing resets the whole set in one move, and
 * `maxPerColumn` is intentionally NOT reset by a filter change: a Dispatcher who loaded 150 cards is
 * still waiting for the rest after narrowing the board.
 */
function BoardFilters({
  filters,
  onChange,
  onClear,
}: {
  filters: BoardFilterState;
  onChange: (next: BoardFilterState) => void;
  onClear: () => void;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2, mb: 2 }} data-testid="board-filters">
      <Grid container spacing={2}>
        <Grid item xs={12} md={3}>
          <TextField
            select
            fullWidth
            size="small"
            label="Status"
            value={filters.status ?? ''}
            onChange={(e) =>
              onChange({ ...filters, status: (e.target.value || undefined) as BoardFilterState['status'] })
            }
            data-testid="filter-status"
          >
            <MenuItem value="">Any status</MenuItem>
            {BOARD_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {status}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField
            select
            fullWidth
            size="small"
            label="Priority"
            value={filters.priority ?? ''}
            onChange={(e) =>
              onChange({ ...filters, priority: (e.target.value || undefined) as BoardFilterState['priority'] })
            }
            data-testid="filter-priority"
          >
            <MenuItem value="">Any priority</MenuItem>
            {BOARD_PRIORITY_OPTIONS.map((priority) => (
              <MenuItem key={priority} value={priority}>
                {priority}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField
            size="small"
            fullWidth
            label="Route id"
            type="number"
            value={filters.routeId ?? ''}
            onChange={(e) =>
              onChange({ ...filters, routeId: e.target.value === '' ? undefined : Number(e.target.value) })
            }
            data-testid="filter-route"
          />
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField
            size="small"
            fullWidth
            label="Reference or destination"
            value={filters.q ?? ''}
            onChange={(e) => onChange({ ...filters, q: e.target.value || undefined })}
            data-testid="filter-q"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <FormControl size="small" fullWidth>
            <InputLabel id="board-sort-label">Sort</InputLabel>
            <Select
              labelId="board-sort-label"
              label="Sort"
              value={filters.sort ?? 'slaDueAt'}
              onChange={(e) => onChange({ ...filters, sort: e.target.value as BoardSort })}
              data-testid="filter-sort"
            >
              {BOARD_SORT_OPTIONS.map((option) => (
                <MenuItem key={option} value={option}>
                  {sortLabel(option)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </Grid>
        <Grid item xs={12} md={4}>
          <FormControlLabel
            control={
              <Switch
                checked={filters.slaRisk === true}
                onChange={(e) => onChange({ ...filters, slaRisk: e.target.checked ? true : undefined })}
                data-testid="filter-sla-risk"
              />
            }
            label="At risk only (BR-2)"
          />
        </Grid>
        <Grid item xs={12} md={4}>
          <Button onClick={onClear} disabled={!hasActiveFilters(filters)} data-testid="filter-clear">
            Clear filters
          </Button>
        </Grid>
      </Grid>
    </Paper>
  );
}

/** AC-2: the flat list, a projection of the same cards the kanban renders — never a second read. */
function BoardList({ board }: { board: PlanningBoardResponse }) {
  return (
    <Paper variant="outlined" data-testid="board-list">
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell>Reference</TableCell>
            <TableCell>Status</TableCell>
            <TableCell>Priority</TableCell>
            <TableCell>Route</TableCell>
            <TableCell align="right">Weight</TableCell>
            <TableCell>SLA due</TableCell>
            <TableCell>At risk</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {flattenBoard(board).map(({ status, card }) => (
            <TableRow key={card.id} data-testid={`board-list-row-${card.id}`} hover>
              <TableCell>{card.referenceCode}</TableCell>
              <TableCell>{status}</TableCell>
              <TableCell>{card.priority}</TableCell>
              <TableCell>{card.routeId ?? 'Unassigned'}</TableCell>
              <TableCell align="right">{card.weightKg}</TableCell>
              <TableCell>{card.slaDueAt ?? '—'}</TableCell>
              <TableCell>{card.atRisk ? 'Yes' : 'No'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Paper>
  );
}

/**
 * The Dispatcher's planning board (LOGI-0011) — a read-only aggregate over
 * `GET /api/v1/planning-board`.
 *
 * The whole screen is one query whose parameters are exactly the filter bar, the sort and the
 * "load more" cap. The kanban and list views are two renderings of that ONE response (AC-2), which
 * is what makes them agree card-for-card: there is no second request that could disagree.
 *
 * Read-only by construction (AC-7): the only controls here are filters, sorting, the view switch,
 * expanding a collapsed column and "load more". Transitions live on the shipment surface and
 * assignments on the route surface, so BR-5 and BR-7 are enforced in exactly one place (spec §7 O3).
 */
export default function PlanningBoardPage() {
  const [filters, setFilters] = useState<BoardFilterState>(EMPTY_FILTERS);
  const [view, setView] = useState<BoardView>('kanban');
  const [maxPerColumn, setMaxPerColumn] = useState(DEFAULT_MAX_PER_COLUMN);
  // Delivered/Cancelled start collapsed (spec §7 O2) — a UI default only. The response still carries
  // all six columns; this state decides how many are rendered open, never what was fetched.
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(BOARD_STATUSES.filter(isTerminalStatus)),
  );

  const params: GetPlanningBoardParams = useMemo(
    () => ({ ...filters, maxPerColumn }),
    [filters, maxPerColumn],
  );
  const { data: board, isPending, isError, error } = usePlanningBoard(params);

  const columns = useMemo(() => (board == null ? [] : orderColumns(board.columns)), [board]);
  const visibleColumns = columns.filter((column) => !collapsed.has(column.status));
  const errorDetail =
    error instanceof ApiError ? (error.problem.detail ?? error.message) : 'Unable to load the board.';

  return (
    <Box data-testid="planning-board">
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h5" component="h2">
          Planning board
        </Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={view}
          onChange={(_, next: BoardView | null) => {
            if (next != null) setView(next);
          }}
          aria-label="Board view"
        >
          <ToggleButton value="kanban" data-testid="view-kanban">
            Kanban
          </ToggleButton>
          <ToggleButton value="list" data-testid="view-list">
            List
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      <BoardFilters filters={filters} onChange={setFilters} onClear={() => setFilters(EMPTY_FILTERS)} />

      {/* AC-5: the unassigned lane is a COUNT beside the board, never a synthetic route row — a fake
          route would put a fake id into the route filter and a fake capacity bar on the screen. */}
      {board != null && (
        <Alert
          severity={board.unassignedTotalCount === 0 ? 'success' : 'warning'}
          sx={{ mb: 2 }}
          data-testid="unassigned-lane"
        >
          {`${board.unassignedTotalCount} shipment${
            board.unassignedTotalCount === 1 ? '' : 's'
          } awaiting assignment`}
        </Alert>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 2 }} data-testid="board-error">
          {errorDetail}
        </Alert>
      )}

      {isPending && board == null && (
        <Stack alignItems="center" sx={{ my: 4 }} data-testid="board-loading">
          <CircularProgress size={28} />
        </Stack>
      )}

      {board != null && (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: 2 }} data-testid="board-routes">
            <Typography variant="subtitle1" component="h3" sx={{ mb: 1 }}>
              Routes
            </Typography>
            {board.routes.length === 0 ? (
              <Typography variant="caption" color="text.secondary">
                No routes for this selection.
              </Typography>
            ) : (
              <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 1 }}>
                {board.routes.map((route) => (
                  <Box key={route.id} sx={{ minWidth: 260, flex: '0 0 260px' }}>
                    <RouteBoardCard route={route} />
                  </Box>
                ))}
              </Stack>
            )}
          </Paper>

          {view === 'kanban' ? (
            <>
              {/* Collapsed columns are still IN the response — these chips only toggle visibility,
                  so expanding Cancelled shows the real cards rather than triggering another read. */}
              <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                {BOARD_STATUSES.filter((status) => collapsed.has(status)).map((status) => {
                  const column = columns.find((c) => c.status === status);
                  return (
                    <Chip
                      key={status}
                      size="small"
                      variant="outlined"
                      label={`${status} (${column?.totalCount ?? 0}) — show`}
                      onClick={() =>
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          next.delete(status);
                          return next;
                        })
                      }
                      data-testid={`board-show-${status}`}
                    />
                  );
                })}
              </Stack>
              <Stack direction="row" spacing={2} sx={{ overflowX: 'auto', pb: 1, alignItems: 'flex-start' }}>
                {visibleColumns.map((column) => (
                  <KanbanColumn
                    key={column.status}
                    column={column}
                    maxPerColumn={maxPerColumn}
                    onLoadMore={setMaxPerColumn}
                  />
                ))}
              </Stack>
            </>
          ) : (
            <BoardList board={board} />
          )}
        </Stack>
      )}
    </Box>
  );
}

