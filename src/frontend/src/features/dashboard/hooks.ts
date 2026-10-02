import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { DashboardResponse, GetDashboardParams } from '../../api/client';

/**
 * Query keys for the operations dashboard (LOGI-0012).
 *
 * The full param set is part of the key on purpose: a filter change or a page step is a genuinely
 * different read, and sharing a key would let one filter's counts be painted under another's tiles.
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  dashboard: (params: GetDashboardParams) => ['dashboard', 'dashboard', params] as const,
};

/**
 * The one and only dashboard read (AC-1/AC-2/AC-3/AC-6/AC-9).
 *
 * There is deliberately NO mutation hook for this feature: the dashboard is read-only (spec §7 O2/O3),
 * because every count it shows is a projection and persisting one would violate BR-2 rule 2.5. Tiles
 * and rows link out to the surfaces that own the work instead.
 *
 * `placeholderData: previous` keeps the last dashboard on screen while a filter change is in flight.
 * That matters more here than on a plain list: flickering empty tiles read as "the operation is
 * clear" rather than "still loading", which is exactly the wrong thing for a manager to believe.
 */
export function useDashboard(params: GetDashboardParams = {}) {
  return useQuery({
    queryKey: dashboardKeys.dashboard(params),
    queryFn: () => api.getDashboard(params),
    placeholderData: (previous) => previous,
  });
}

export type { DashboardResponse };