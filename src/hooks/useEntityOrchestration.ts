import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClient } from '@/lib/apiClient';

interface UseEntityOrchestrationOptions {
  queryKey: string[];
  endpoint: string;
  entityName: string;
  apiClient: ApiClient;
}

export function useEntityOrchestration<T extends { id: string }>({
  queryKey,
  endpoint,
  entityName,
  apiClient,
}: UseEntityOrchestrationOptions) {
  const queryClient = useQueryClient();

  const {
    data = [],
    isLoading,
    isError,
    error,
    refetch: fetchAll,
  } = useQuery<T[], Error>({
    queryKey,
    queryFn: async () => apiClient.get<T[]>(endpoint),
  });

  const { mutateAsync: create } = useMutation({
    mutationFn: async (payload: Partial<T>) => apiClient.post<T>(endpoint, payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      const optimisticId = `temp-${Date.now()}-${Math.random()}`;
      if (previousData) {
        const optimisticItem = { id: optimisticId, ...payload } as unknown as T;
        queryClient.setQueryData<T[]>(queryKey, old => [optimisticItem, ...(old || [])]);
      }
      return { previousData, optimisticId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSuccess: (newItem, _variables, context) => {
      queryClient.setQueryData<T[]>(queryKey, old => 
        old?.map(item => item.id === context?.optimisticId ? newItem : item)
      );
    },
    meta: {
      successMessage: `Created ${entityName} successfully.`,
    }
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
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<T[]>(queryKey, old =>
        old?.map(item => item.id === updatedItem.id ? updatedItem : item)
      );
    },
    meta: {
      successMessage: `Updated ${entityName} successfully.`,
    }
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
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    meta: {
      successMessage: `Deleted ${entityName} successfully.`,
    }
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
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    meta: {
      successMessage: `Reordered ${entityName} successfully.`,
    }
  });

  return {
    data,
    isLoading,
    isError,
    error,
    fetchAll,
    create,
    update: (id: string, payload: Partial<T>) => update({ id, payload }),
    remove,
    reorder,
  };
}
