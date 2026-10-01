import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { GetPlanningBoardParams, PlanningBoardResponse } from '../../api/client';

/**
 * Query keys for the planning board (LOGI-0011).
 *
 * The full filter set (including `maxPerColumn`) is part of the key on purpose: "load more" and every
 * filter change are genuinely different reads, and sharing a key would let one filter's cards be
 * served for another's.
 */
export const planningBoardKeys = {
  all: ['planning-board'] as const,
  board: (params: GetPlanningBoardParams) => ['planning-board', 'board', params] as const,
};

/**
 * The one and only board read (AC-1/AC-2/AC-3/AC-6/AC-9).
 *
 * There is deliberately NO mutation hook for this feature: the board is read-only in v1 (spec §7 O3),
 * because a drag would be a second BR-7 entry point and a drop-on-route a second BR-5 one. Both live
 * on their own surfaces, so BR-5 and BR-7 are enforced in exactly one place.
 *
 * `placeholderData: previous` keeps the last board on screen while a filter change is in flight, which
 * matters here more than on a plain list: flickering six empty columns would read as "the shipments
 * are gone" rather than "still loading".
 */
export function usePlanningBoard(params: GetPlanningBoardParams = {}) {
  return useQuery({
    queryKey: planningBoardKeys.board(params),
    queryFn: () => api.getPlanningBoard(params),
    placeholderData: (previous) => previous,
  });
}

export type { PlanningBoardResponse };
