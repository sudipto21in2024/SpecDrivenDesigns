import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ShipmentInput, ShipmentUpdateInput, ListShipmentsParams, StatusTransitionRequest } from '../../api/client';

/** Query keys for the shipments feature (hierarchical for targeted invalidation). */
export const shipmentKeys = {
  all: ['shipments'] as const,
  list: (params: ListShipmentsParams) => ['shipments', 'list', params] as const,
  /** LOGI-0008 AC-6: the detail read the edit dialog pre-fills from. */
  detail: (id: number) => ['shipments', 'detail', id] as const,
};

/** F8 (AC-6..AC-9): paged, filterable shipment list — params drive the query key for caching. */
export function useShipments(params: ListShipmentsParams) {
  return useQuery({
    queryKey: shipmentKeys.list(params),
    queryFn: () => api.listShipments(params),
  });
}

function useInvalidateShipments() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: shipmentKeys.all });
}

/** F5 (AC-1): create a shipment and refresh the list on success. */
export function useCreateShipment() {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: (input: ShipmentInput) => api.createShipment(input),
    onSuccess: () => invalidate(),
  });
}

/**
 * LOGI-0008 AC-6: single-shipment detail. `enabled` lets the edit dialog only fetch once the user
 * actually opens it, so the list page issues no per-row reads.
 */
export function useShipment(id: number, enabled = true) {
  return useQuery({
    queryKey: shipmentKeys.detail(id),
    queryFn: () => api.getShipment(id),
    enabled,
  });
}

/**
 * LOGI-0008 AC-1: partial edit of a Pending shipment. Invalidates the whole shipments tree so both
 * the list row and the detail cache pick up the new values (the row refreshes without a refetch of
 * the page, per AC-11).
 */
export function useUpdateShipment() {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: ShipmentUpdateInput }) => api.updateShipment(id, body),
    onSuccess: () => invalidate(),
  });
}

/**
 * LOGI-0008 AC-8: cancel via the existing BR-7 transitions endpoint (no new status-write path).
 * The audit echo is returned so the caller can surface it.
 */
export function useCancelShipment() {
  const invalidate = useInvalidateShipments();
  return useMutation({
    mutationFn: ({ id, note }: { id: number; note?: string }) =>
      api.transitionShipmentStatus(id, { toStatus: 'Cancelled', note: note?.trim() ? note.trim() : null } as StatusTransitionRequest),
    onSuccess: () => invalidate(),
  });
}
