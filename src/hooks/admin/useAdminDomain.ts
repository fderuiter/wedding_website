import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/lib/admin/apiClient';
import { useToast } from '@/components/ui/ToastProvider';

export function useAdminDomain<T extends { id: string }>(domain: string, entityName: string, endpointOverride?: string) {
  const queryClient = useQueryClient();
  const { addToast } = useToast();
  const queryKey = [`admin-${domain}`];
  const endpoint = endpointOverride || `/api/admin/${domain}`;

  const { data = [], isLoading: loading, error: queryError } = useQuery<T[], Error>({
    queryKey,
    queryFn: async () => apiClient.get<T[]>(endpoint),
  });

  const error = queryError ? queryError.message : null;

  const { mutateAsync: create } = useMutation({
    mutationFn: async (payload: Partial<T>) => apiClient.post<T>(endpoint, payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        const optimisticItem = { id: `temp-${Date.now()}`, ...payload } as unknown as T;
        // Depending on list display, prepend or append. We will prepend.
        queryClient.setQueryData<T[]>(queryKey, old => [optimisticItem, ...(old || [])]);
      }
      return { previousData };
    },
    onError: (err: any, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      addToast(err.message || `Error creating ${entityName}`, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutateAsync: update } = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<T> }) => apiClient.put<T>(`${endpoint}/${id}`, payload),
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        queryClient.setQueryData<T[]>(queryKey, old => 
          old?.map(item => item.id === id ? { ...item, ...payload } : item)
        );
      }
      return { previousData };
    },
    onError: (err: any, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      addToast(err.message || `Error updating ${entityName}`, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutateAsync: remove } = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`${endpoint}/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        queryClient.setQueryData<T[]>(queryKey, old => old?.filter(item => item.id !== id));
      }
      return { previousData };
    },
    onError: (err: any, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      addToast(err.message || `Error deleting ${entityName}`, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  const { mutateAsync: reorder } = useMutation({
    mutationFn: async (orderedIds: string[]) => apiClient.put(endpoint, { action: 'reorder', orderedIds }),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        const sorted = [...previousData].sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));
        queryClient.setQueryData<T[]>(queryKey, sorted);
      }
      return { previousData };
    },
    onError: (err: any, variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
      addToast(err.message || `Error reordering ${entityName}`, 'error');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    data,
    loading,
    error,
    create,
    update: (id: string, payload: Partial<T>) => update({ id, payload }),
    remove,
    reorder,
    fetchAll: () => queryClient.invalidateQueries({ queryKey })
  };
}
