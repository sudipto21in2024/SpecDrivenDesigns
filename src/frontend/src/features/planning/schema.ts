import type {
  BoardColumn,
  BoardShipmentCard,
  GetPlanningBoardParams,
  PlanningBoardResponse,
  ShipmentPriority,
  ShipmentStatus,
} from '../../api/client';

/**
 * Planning-board view model helpers (LOGI-0011).
 *
 * Everything here is presentation logic over ONE response: the board never refetches per view and
 * never filters client-side over an unpaged list (spec §5). The column ORDER constant exists only to
 * render in lifecycle order if the server ever changes sequence — the six statuses are server-owned
 * and the API always returns all of them (AC-1, spec §7 O2), so this is a sort, not a whitelist.
 */

/** The six BR-7 statuses in lifecycle order — the kanban's column order (AC-1). */
export const BOARD_STATUSES: readonly ShipmentStatus[] = [
  'Pending',
  'Assigned',
  'InTransit',
  'Delivered',
  'Delayed',
  'Cancelled',
];

/**
 * Terminal statuses collapsed by default IN THE UI ONLY (spec §7 O2).
 *
 * The API still returns all six columns; collapsing is a screen-size decision the server must never
 * encode. A Dispatcher auditing a cancelled load expands the column rather than losing it.
 */
export const TERMINAL_STATUSES: readonly ShipmentStatus[] = ['Delivered', 'Cancelled'];

/** Board sort keys (contract enum); the default is the earliest SLA first. */
export type BoardSort = NonNullable<GetPlanningBoardParams['sort']>;

/** The filter bar's state. Every field is optional; `undefined` means "not supplied" (AC-3). */
export type BoardFilterState = Omit<GetPlanningBoardParams, 'maxPerColumn'>;

export const EMPTY_FILTERS: BoardFilterState = {};

/** Default `maxPerColumn` per the contract — also the step size of "load more" (AC-8). */
export const DEFAULT_MAX_PER_COLUMN = 50;

/** Contract ceiling for `maxPerColumn`; "load more" must never ask for more than this. */
export const MAX_PER_COLUMN_LIMIT = 200;

export function isTerminalStatus(status: ShipmentStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

/** Renders the columns in lifecycle order regardless of the sequence the server sent them (AC-1). */
export function orderColumns(columns: BoardColumn[]): BoardColumn[] {
  return [...columns].sort(
    (a, b) => BOARD_STATUSES.indexOf(a.status) - BOARD_STATUSES.indexOf(b.status),
  );
}

/**
 * Flattens every column into one list, keeping each card's owning status.
 *
 * This is what makes the list view and the kanban view agree card-for-card (AC-2): both render the
 * SAME cards from the SAME response, so the only difference between the two views is presentation.
 * The board does not re-sort client-side — the server already applied `sort` with an id tiebreak
 * (AC-9), and re-sorting here could disagree with it.
 */
export function flattenBoard(board: PlanningBoardResponse): { status: ShipmentStatus; card: BoardShipmentCard }[] {
  return orderColumns(board.columns).flatMap((column) =>
    column.cards.map((card) => ({ status: column.status, card })),
  );
}

/** True when at least one filter is set, so the UI can offer a "clear filters" affordance. */
export function hasActiveFilters(filters: BoardFilterState): boolean {
  return Object.values(filters).some((value) => value !== undefined && value !== '');
}

/**
 * Human-readable label for a sort key. `slaDueAt` first is the dispatcher's actual question
 * ("what is late?"), which is why it is the server default rather than recency.
 */
export function sortLabel(sort: BoardSort): string {
  switch (sort) {
    case 'slaDueAt':
      return 'SLA due (earliest first)';
    case '-slaDueAt':
      return 'SLA due (latest first)';
    case 'createdAt':
      return 'Created (oldest first)';
    case '-createdAt':
      return 'Created (newest first)';
  }
}

export const BOARD_SORT_OPTIONS: readonly BoardSort[] = [
  'slaDueAt',
  '-slaDueAt',
  'createdAt',
  '-createdAt',
];

export const BOARD_PRIORITY_OPTIONS: readonly ShipmentPriority[] = ['Standard', 'Express'];

/**
 * The next `maxPerColumn` for a truncated column's "load more" (AC-8).
 *
 * The endpoint has no per-column cursor, so loading more means asking for a bigger slice — capped at
 * the contract maximum, and never below what is already shown. Returns null when the column is not
 * truncated or is already fully loaded, so the button disappears instead of issuing a no-op read.
 */
export function nextMaxPerColumn(column: BoardColumn, current: number): number | null {
  if (!column.truncated) return null;
  const next = Math.min(MAX_PER_COLUMN_LIMIT, Math.max(current, column.cards.length) + DEFAULT_MAX_PER_COLUMN);
  return next > current ? next : null;
}
