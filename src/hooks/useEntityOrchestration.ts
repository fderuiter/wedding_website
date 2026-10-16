import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClient } from '@/lib/apiClient';
import { generateSecureUUID } from '@/utils/uuid';

const EMPTY_ARRAY: readonly any[] = Object.freeze([]);

interface UseEntityOrchestrationOptions {
  queryKey: (string | number)[];
  endpoint: string;
  entityName: string;
  apiClient: ApiClient;
  enabled?: boolean;
}

export function useEntityOrchestration<T extends { id: string }>({
  queryKey,
  endpoint,
  entityName,
  apiClient,
  enabled,
}: UseEntityOrchestrationOptions) {
  const queryClient = useQueryClient();

  const {
    data = EMPTY_ARRAY as unknown as T[],
    isLoading,
    isError,
    error,
    refetch: fetchAll,
  } = useQuery<T[], Error>({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get<any>(endpoint);
      if (res && typeof res === 'object' && Array.isArray(res.items)) {
        return res.items as T[];
      }
      return (Array.isArray(res) ? res : []) as T[];
    },
    enabled,
  });

  const { mutateAsync: createItem } = useMutation({
    mutationFn: async (payload: Partial<T>) => apiClient.post<T>(endpoint, payload),
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      const optimisticId = `temp-${generateSecureUUID()}`;
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

  const { mutateAsync: updateItem } = useMutation({
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

  const { mutateAsync: removeItem } = useMutation({
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

  const { mutateAsync: removeBatchItems } = useMutation({
    mutationFn: async (ids: string[]) => {
      await Promise.all(ids.map(id => apiClient.delete(`${endpoint}/${id}`)));
    },
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        const idSet = new Set(ids);
        queryClient.setQueryData<T[]>(queryKey, old => old?.filter(item => !idSet.has(item.id)));
      }
      return { previousData };
    },
    onSuccess: (_data, ids) => {
      const idSet = new Set(ids);
      queryClient.setQueryData<T[]>(queryKey, old => old?.filter(item => !idSet.has(item.id)));
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    meta: {
      successMessage: `Deleted selected ${entityName}s successfully.`,
    }
  });

  const { mutateAsync: updateBatchItems } = useMutation({
    mutationFn: async ({ ids, payload }: { ids: string[]; payload: Partial<T> }) => {
      await Promise.all(ids.map(id => apiClient.put<T>(`${endpoint}/${id}`, payload)));
    },
    onMutate: async ({ ids, payload }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        const idSet = new Set(ids);
        queryClient.setQueryData<T[]>(queryKey, old =>
          old?.map(item => idSet.has(item.id) ? { ...item, ...payload } : item)
        );
      }
      return { previousData };
    },
    onSuccess: (_data, variables) => {
      const idSet = new Set(variables.ids);
      queryClient.setQueryData<T[]>(queryKey, old =>
        old?.map(item => idSet.has(item.id) ? { ...item, ...variables.payload } : item)
      );
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    meta: {
      successMessage: `Updated selected ${entityName}s successfully.`,
    }
  });

  const { mutateAsync: reorderItems } = useMutation({
    mutationFn: async (orderedIds: string[]) => apiClient.put(endpoint, { action: 'reorder', orderedIds }),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      if (previousData) {
        const entityMap = new Map<string, T>(previousData.map(entity => [entity.id, entity]));
        const reordered: T[] = [];
        for (const id of orderedIds) {
          const entity = entityMap.get(id);
          if (entity) {
            reordered.push(entity);
            entityMap.delete(id);
          }
        }
        reordered.push(...entityMap.values());
        queryClient.setQueryData<T[]>(queryKey, reordered);
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
    create: createItem,
    update: (id: string, payload: Partial<T>) => updateItem({ id, payload }),
    updateBatch: (ids: string[], payload: Partial<T>) => updateBatchItems({ ids, payload }),
    remove: removeItem,
    removeBatch: removeBatchItems,
    reorder: reorderItems,
  };
}
