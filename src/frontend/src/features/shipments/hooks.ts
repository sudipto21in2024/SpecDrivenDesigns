import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { ShipmentInput, ListShipmentsParams } from '../../api/client';

/** Query keys for the shipments feature (hierarchical for targeted invalidation). */
export const shipmentKeys = {
  all: ['shipments'] as const,
  list: (params: ListShipmentsParams) => ['shipments', 'list', params] as const,
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
