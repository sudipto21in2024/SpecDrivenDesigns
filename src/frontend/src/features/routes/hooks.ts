import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ListRoutesParams, RouteInput, RouteUpdateInput } from '../../api/client';

/** Query keys for the routes feature (hierarchical for targeted invalidation). */
export const routeKeys = {
  all: ['routes'] as const,
  list: (params: ListRoutesParams) => ['routes', 'list', params] as const,
  /** The detail read the edit dialog pre-fills from. */
  detail: (id: number) => ['routes', 'detail', id] as const,
};

/** AC-9: paged, filterable route list — params drive the query key for caching. */
export function useRoutes(params: ListRoutesParams) {
  return useQuery({
    queryKey: routeKeys.list(params),
    queryFn: () => api.listRoutes(params),
    placeholderData: (previous) => previous,
  });
}

/**
 * AC-6: single-route detail. `enabled` lets the edit dialog fetch only once the user actually
 * opens it, so the list page issues no per-row reads.
 */
export function useRoute(id: number, enabled = true) {
  return useQuery({
    queryKey: routeKeys.detail(id),
    queryFn: () => api.getRoute(id),
    enabled,
  });
}

function useInvalidateRoutes() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: routeKeys.all });
}

/** AC-1: create a route and refresh the list on success. */
export function useCreateRoute() {
  const invalidate = useInvalidateRoutes();
  return useMutation({
    mutationFn: (input: RouteInput) => api.createRoute(input),
    onSuccess: () => invalidate(),
  });
}

/**
 * AC-2: partial update / assignment. Invalidates the whole routes tree so both the list row and
 * the detail cache pick up the new values.
 */
export function useUpdateRoute() {
  const invalidate = useInvalidateRoutes();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: RouteUpdateInput }) => api.updateRoute(id, body),
    onSuccess: () => invalidate(),
  });
}
