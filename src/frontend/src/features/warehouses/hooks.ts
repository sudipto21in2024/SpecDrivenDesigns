import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { WarehouseInput } from '../../api/client';

/** Query keys for the warehouses feature (hierarchical for targeted invalidation). */
export const warehouseKeys = {
  all: ['warehouses'] as const,
  list: (page: number, pageSize: number, q: string) => ['warehouses', 'list', { page, pageSize, q }] as const,
};

/** AC-4: paged warehouse list. */
export function useWarehouses(page: number, pageSize: number, q: string) {
  return useQuery({
    queryKey: warehouseKeys.list(page, pageSize, q),
    queryFn: () => api.listWarehouses(page, pageSize, q || undefined),
  });
}

function useInvalidateWarehouses() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: warehouseKeys.all });
}

/** AC-1: create warehouse. */
export function useCreateWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: (input: WarehouseInput) => api.createWarehouse(input),
    onSuccess: () => invalidate(),
  });
}

/** AC-6: update warehouse. */
export function useUpdateWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: WarehouseInput }) => api.updateWarehouse(id, input),
    onSuccess: () => invalidate(),
  });
}

/** AC-7: delete warehouse. */
export function useDeleteWarehouse() {
  const invalidate = useInvalidateWarehouses();
  return useMutation({
    mutationFn: (id: number) => api.deleteWarehouse(id),
    onSuccess: () => invalidate(),
  });
}
