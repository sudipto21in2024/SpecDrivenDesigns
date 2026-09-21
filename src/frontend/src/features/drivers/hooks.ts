import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import type { DriverInput } from '../../api/client';

/** Query keys for the drivers feature (hierarchical for targeted invalidation). */
export const driverKeys = {
  all: ['drivers'] as const,
  list: (page: number, pageSize: number, q: string, status: string) =>
    ['drivers', 'list', { page, pageSize, q, status }] as const,
  detail: (id: number) => ['drivers', 'detail', id] as const,
};

/** AC-1/AC-7: paged driver list with full-name search + status filter. */
export function useDrivers(
  page: number,
  pageSize: number,
  q: string,
  status: string,
) {
  return useQuery({
    queryKey: driverKeys.list(page, pageSize, q, status),
    queryFn: () => api.listDrivers(page, pageSize, q || undefined, status || undefined),
    placeholderData: (previous) => previous,
  });
}

function useInvalidateDrivers() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: driverKeys.all });
}

/** AC-1: create driver. */
export function useCreateDriver() {
  const invalidate = useInvalidateDrivers();
  return useMutation({
    mutationFn: (input: DriverInput) => api.createDriver(input),
    onSuccess: () => invalidate(),
  });
}

/** AC-6/AC-8: update driver. */
export function useUpdateDriver() {
  const invalidate = useInvalidateDrivers();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: DriverInput }) => api.updateDriver(id, input),
    onSuccess: () => invalidate(),
  });
}

/** AC-8: delete driver. */
export function useDeleteDriver() {
  const invalidate = useInvalidateDrivers();
  return useMutation({
    mutationFn: (id: number) => api.deleteDriver(id),
    onSuccess: () => invalidate(),
  });
}
