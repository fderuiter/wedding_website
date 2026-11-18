import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiClient } from '@/lib/apiClient';
import { generateSecureUUID } from '@/utils/uuid';

const EMPTY_ARRAY: readonly any[] = Object.freeze([]);

interface UseEntityOrchestrationOptions {
  queryKey: (string | number)[];
  endpoint: string;
  fetchEndpoint?: string;
  invalidateQueryKeys?: (string | number)[][];
  entityName: string;
  apiClient: ApiClient;
  enabled?: boolean;
}

function unwrapEntityResponse<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'item' in res && (res as { item?: unknown }).item) {
    return (res as { item: T }).item;
  }
  return res as T;
}

export function useEntityOrchestration<T extends { id: string }>({
  queryKey,
  endpoint,
  fetchEndpoint,
  invalidateQueryKeys,
  entityName,
  apiClient,
  enabled,
}: UseEntityOrchestrationOptions) {
  const queryClient = useQueryClient();

  const invalidateRelatedQueries = () => {
    if (!invalidateQueryKeys) return;
    for (const key of invalidateQueryKeys) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const {
    data = EMPTY_ARRAY as unknown as T[],
    isLoading,
    isError,
    error,
    refetch: fetchAll,
  } = useQuery<T[], Error>({
    queryKey,
    queryFn: async () => {
      const res = await apiClient.get<any>(fetchEndpoint ?? endpoint);
      if (res && typeof res === 'object' && Array.isArray(res.items)) {
        return res.items as T[];
      }
      return (Array.isArray(res) ? res : []) as T[];
    },
    enabled,
  });

  const { mutateAsync: createItem } = useMutation({
    mutationFn: async (payload: Partial<T>) => {
      const res = await apiClient.post<T>(endpoint, payload);
      return unwrapEntityResponse<T>(res);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<T[]>(queryKey);
      const optimisticId = `temp-${generateSecureUUID()}`;
      const optimisticItem = { id: optimisticId, ...payload } as unknown as T;
      queryClient.setQueryData<T[]>(queryKey, old => [optimisticItem, ...(old || [])]);
      return { previousData, optimisticId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(queryKey, context.previousData);
      }
    },
    onSuccess: (newItem, _variables, context) => {
      queryClient.setQueryData<T[]>(queryKey, old => {
        if (!old || old.length === 0) return [newItem];
        const exists = old.some(item => item.id === context?.optimisticId || item.id === newItem.id);
        if (exists) {
          return old.map(item => (item.id === context?.optimisticId || item.id === newItem.id) ? newItem : item);
        }
        return [newItem, ...old];
      });
      invalidateRelatedQueries();
    },
    meta: {
      successMessage: `Created ${entityName} successfully.`,
    }
  });

  const { mutateAsync: updateItem } = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<T> }) => {
      const res = await apiClient.put<T>(`${endpoint}/${id}`, payload);
      return unwrapEntityResponse<T>(res);
    },
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
      invalidateRelatedQueries();
    },
    meta: {
      successMessage: `Updated ${entityName} successfully.`,
    }
  });

  const { mutateAsync: removeItem } = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`${endpoint}/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<unknown>(queryKey);
      if (Array.isArray(previousData)) {
        queryClient.setQueryData<T[]>(queryKey, old => old?.filter(item => item.id !== id));
      } else if (
        previousData &&
        typeof previousData === 'object' &&
        Array.isArray((previousData as { items?: T[] }).items)
      ) {
        queryClient.setQueryData(queryKey, (old: { items: T[]; total?: number } | undefined) =>
          old
            ? {
              ...old,
              items: old.items.filter(item => item.id !== id),
              ...(typeof old.total === 'number' ? { total: Math.max(0, old.total - 1) } : {}),
            }
            : old
        );
      }
      return { previousData };
    },
    onSuccess: () => {
      invalidateRelatedQueries();
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
    mutationFn: async (ids: string[]) => apiClient.delete(`${endpoint}/batch`, { ids }),
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
      invalidateRelatedQueries();
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
    mutationFn: async ({ ids, payload }: { ids: string[]; payload: Partial<T> }) =>
      apiClient.post<any>(`${endpoint}/batch`, { ids, ...payload }),
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
      invalidateRelatedQueries();
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
    onSuccess: () => {
      invalidateRelatedQueries();
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
