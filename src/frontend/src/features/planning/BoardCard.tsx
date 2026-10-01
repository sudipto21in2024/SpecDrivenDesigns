import { Box, Chip, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import type { BoardRouteCard, BoardShipmentCard, RouteCapacityView } from '../../api/client';

/**
 * Board card rendering (LOGI-0011 AC-1/AC-4/AC-5/AC-7).
 *
 * These are deliberately dumb presentational components: every value they show comes from the one
 * board response, and there is not a single interactive control that mutates state. A Dispatcher
 * needing a transition or an assignment leaves for the shipment or route surface (AC-7, spec §7 O3) —
 * a second entry point to BR-5 or BR-7 here would mean enforcing the same rule twice.
 */

/** Compact date for a card: the day and the clock, UTC, so tests and dispatchers agree. */
function shortInstant(iso: string | null | undefined): string {
  if (iso == null) return '—';
  return iso.replace('T', ' ').slice(0, 16) + 'Z';
}

/**
 * AC-4: the BR-5 capacity bar.
 *
 * `capacityKg`/`remainingCapacityKg` are null when the route has no vehicle, and that renders as an
 * explicit "no vehicle assigned" state — NEVER as 0 kg remaining, which would tell the dispatcher
 * the truck is full. This is the same projection the assign dialog enforces against (spec §7 O4), so
 * the bar and the guard can never disagree.
 */
export function CapacityBar({ capacity, testId }: { capacity: RouteCapacityView; testId: string }) {
  const unknownCapacity = capacity.capacityKg == null;
  const percentUsed =
    unknownCapacity || capacity.capacityKg == null || capacity.capacityKg === 0
      ? 0
      : Math.min(100, (capacity.assignedWeightKg / capacity.capacityKg) * 100);

  return (
    <Box data-testid={testId}>
      {unknownCapacity ? (
        <Typography variant="caption" color="text.secondary" data-testid={`${testId}-unknown`}>
          No vehicle assigned
        </Typography>
      ) : (
        <>
          <Typography variant="caption" color="text.secondary" data-testid={`${testId}-numbers`}>
            {`${capacity.remainingCapacityKg} kg free of ${capacity.capacityKg} kg`}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={percentUsed}
            aria-label={`${testId} capacity used`}
            sx={{ mt: 0.5, height: 6, borderRadius: 3 }}
          />
        </>
      )}
    </Box>
  );
}

/**
 * AC-1/AC-5/AC-7: one shipment card.
 *
 * `routeId === null` is rendered as an explicit "Unassigned" chip rather than a blank, because the
 * unassigned backlog is exactly what the Dispatcher opened the board to find (AC-5).
 */
export function ShipmentBoardCard({ card }: { card: BoardShipmentCard }) {
  return (
    <Paper variant="outlined" data-testid={`board-card-${card.id}`} sx={{ p: 1 }}>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" data-testid={`board-card-ref-${card.id}`}>
            {card.referenceCode}
          </Typography>
          {card.atRisk && (
            <Chip size="small" color="error" label="At risk" data-testid={`board-card-risk-${card.id}`} />
          )}
        </Stack>
        <Typography variant="body2" data-testid={`board-card-destination-${card.id}`}>
          {card.destinationAddress}
        </Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
          <Chip size="small" label={card.priority} />
          <Chip size="small" label={`${card.weightKg} kg`} />
          {card.routeId == null ? (
            <Chip
              size="small"
              color="warning"
              label="Unassigned"
              data-testid={`board-card-unassigned-${card.id}`}
            />
          ) : (
            <Chip
              size="small"
              variant="outlined"
              label={`Route ${card.routeId}`}
              data-testid={`board-card-route-${card.id}`}
            />
          )}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {`SLA ${shortInstant(card.slaDueAt)}`}
        </Typography>
      </Stack>
    </Paper>
  );
}

/** AC-4: one route card — identity, window and the shared BR-5 capacity bar. */
export function RouteBoardCard({ route }: { route: BoardRouteCard }) {
  return (
    <Paper variant="outlined" data-testid={`board-route-${route.id}`} sx={{ p: 1 }}>
      <Stack spacing={0.5}>
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle2" data-testid={`board-route-name-${route.id}`}>
            {route.name}
          </Typography>
          <Chip size="small" label={route.status} />
        </Stack>
        <Typography variant="caption" color="text.secondary">
          {`${shortInstant(route.plannedStart)} → ${shortInstant(route.plannedEnd)}`}
        </Typography>
        <Typography variant="caption" color="text.secondary" data-testid={`board-route-load-${route.id}`}>
          {`${route.capacity.assignedWeightKg} kg across ${route.capacity.shipmentCount} shipment${
            route.capacity.shipmentCount === 1 ? '' : 's'
          }`}
        </Typography>
        <CapacityBar capacity={route.capacity} testId={`board-route-capacity-${route.id}`} />
      </Stack>
    </Paper>
  );
}
