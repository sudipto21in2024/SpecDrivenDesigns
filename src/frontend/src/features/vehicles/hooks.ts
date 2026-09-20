import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { VehicleInput } from '../../api/client';

/** Query keys for the vehicles feature (hierarchical for targeted invalidation). */
export const vehicleKeys = {
  all: ['vehicles'] as const,
  list: (page: number, pageSize: number, q: string, status: string, type: string) =>
    ['vehicles', 'list', { page, pageSize, q, status, type }] as const,
};

/** AC-7: paged vehicle list with plate search + status/type filters. */
export function useVehicles(page: number, pageSize: number, q: string, status: string, type: string) {
  return useQuery({
    queryKey: vehicleKeys.list(page, pageSize, q, status, type),
    queryFn: () =>
      api.listVehicles(page, pageSize, q || undefined, status || undefined, type || undefined),
    placeholderData: (previous) => previous,
  });
}

function useInvalidateVehicles() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: vehicleKeys.all });
}

/** AC-1: create vehicle. */
export function useCreateVehicle() {
  const invalidate = useInvalidateVehicles();
  return useMutation({
    mutationFn: (input: VehicleInput) => api.createVehicle(input),
    onSuccess: () => invalidate(),
  });
}

/** AC-8: update vehicle. */
export function useUpdateVehicle() {
  const invalidate = useInvalidateVehicles();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: VehicleInput }) => api.updateVehicle(id, input),
    onSuccess: () => invalidate(),
  });
}

/** AC-8: delete vehicle. */
export function useDeleteVehicle() {
  const invalidate = useInvalidateVehicles();
  return useMutation({
    mutationFn: (id: number) => api.deleteVehicle(id),
    onSuccess: () => invalidate(),
  });
}
