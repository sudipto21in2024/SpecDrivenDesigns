import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type {
  AssignShipmentToRouteInput,
  ListRouteShipmentsParams,
  ListRoutesParams,
  RouteInput,
  RouteUpdateInput,
} from '../../api/client';
import { shipmentKeys } from '../shipments/hooks';

/** Query keys for the routes feature (hierarchical for targeted invalidation). */
export const routeKeys = {
  all: ['routes'] as const,
  list: (params: ListRoutesParams) => ['routes', 'list', params] as const,
  /** The detail read the edit dialog pre-fills from. */
  detail: (id: number) => ['routes', 'detail', id] as const,
  /** LOGI-0010 AC-8: one route's assigned shipments + its capacity projection. */
  shipments: (id: number, params: ListRouteShipmentsParams) =>
    ['routes', 'shipments', id, params] as const,
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

/**
 * LOGI-0010 AC-8: a route's assigned shipments with the BR-5 capacity projection. `enabled` keeps
 * the read dormant until the panel is actually open, so the list page issues no per-row calls.
 * `placeholderData` preserves the previous page while paging, so the table does not flash empty.
 */
export function useRouteShipments(id: number, params: ListRouteShipmentsParams = {}, enabled = true) {
  return useQuery({
    queryKey: routeKeys.shipments(id, params),
    queryFn: () => api.listRouteShipments(id, params),
    enabled,
    placeholderData: (previous) => previous,
  });
}

/**
 * Assign/unassign invalidate BOTH trees, because a single action changes two read models: the
 * route's own list (and its capacity projection), and the shipment read model, whose `routeId`
 * and status just moved Pending <-> Assigned. The shipment's status history is read through the
 * shipments tree too, so the appended LOGI-0010 row shows up without a manual refetch (AC-1/AC-6).
 */
function useInvalidateRouteShipments() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: routeKeys.all });
    void queryClient.invalidateQueries({ queryKey: shipmentKeys.all });
  };
}

/** LOGI-0010 AC-1: add a shipment to a route (the 409 capacity guard is surfaced by the caller). */
export function useAssignShipmentToRoute() {
  const invalidate = useInvalidateRouteShipments();
  return useMutation({
    mutationFn: ({ routeId, body }: { routeId: number; body: AssignShipmentToRouteInput }) =>
      api.assignShipmentToRoute(routeId, body),
    onSuccess: () => invalidate(),
  });
}

/** LOGI-0010 AC-6: unassign, returning the shipment to Pending and freeing its weight. */
export function useRemoveShipmentFromRoute() {
  const invalidate = useInvalidateRouteShipments();
  return useMutation({
    mutationFn: ({ routeId, shipmentId }: { routeId: number; shipmentId: number }) =>
      api.removeShipmentFromRoute(routeId, shipmentId),
    onSuccess: () => invalidate(),
  });
}
