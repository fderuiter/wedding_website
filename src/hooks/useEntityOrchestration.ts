import { useQuery, useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiClient } from '@/lib/apiClient';
import { generateSecureUUID } from '@/utils/uuid';

const EMPTY_ARRAY: readonly never[] = Object.freeze([]);

interface PaginatedEntityCache<T> {
  items: T[];
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
}

type EntityCacheValue<T> = T[] | PaginatedEntityCache<T>;

interface UseEntityOrchestrationOptions {
  queryKey: QueryKey;
  endpoint: string;
  fetchEndpoint?: string;
  invalidateQueryKeys?: readonly QueryKey[];
  entityName: string;
  apiClient: ApiClient;
  enabled?: boolean;
}

function isPaginatedEntityCache<T>(value: unknown): value is PaginatedEntityCache<T> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as { items?: unknown }).items)
  );
}

function extractEntityItems<T>(res: unknown): T[] {
  if (Array.isArray(res)) {
    return res as T[];
  }
  if (isPaginatedEntityCache<T>(res)) {
    return res.items;
  }
  return [];
}

function unwrapEntityResponse<T>(res: unknown): T {
  if (res && typeof res === 'object' && 'item' in res && (res as { item?: unknown }).item) {
    return (res as { item: T }).item;
  }
  return res as T;
}

function updateEntityCache<T>(
  old: EntityCacheValue<T> | undefined,
  updater: (_items: T[]) => T[],
  totalDelta = 0
): EntityCacheValue<T> | undefined {
  if (old === undefined) {
    const nextItems = updater([]);
    return nextItems.length > 0 ? nextItems : old;
  }
  if (Array.isArray(old)) {
    return updater(old);
  }
  if (isPaginatedEntityCache<T>(old)) {
    const nextItems = updater(old.items);
    const nextTotal =
      typeof old.total === 'number' ? Math.max(0, old.total + totalDelta) : undefined;
    const nextTotalPages =
      typeof nextTotal === 'number' && typeof old.limit === 'number' && old.limit > 0
        ? Math.max(1, Math.ceil(nextTotal / old.limit))
        : old.totalPages;
    return {
      ...old,
      items: nextItems,
      ...(typeof nextTotal === 'number' ? { total: nextTotal } : {}),
      ...(typeof nextTotalPages === 'number' ? { totalPages: nextTotalPages } : {}),
    };
  }
  return old;
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

  const restorePreviousCache = (context: { previousData?: EntityCacheValue<T> } | undefined) => {
    if (context && context.previousData !== undefined) {
      queryClient.setQueryData(queryKey, context.previousData);
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
      const res = await apiClient.get<unknown>(fetchEndpoint ?? endpoint);
      return extractEntityItems<T>(res);
    },
    enabled,
  });

  const { mutateAsync: createItem } = useMutation({
    mutationFn: async (payload: Partial<T>) => {
      const res = await apiClient.post<unknown>(endpoint, payload);
      return unwrapEntityResponse<T>(res);
    },
    onMutate: async (payload) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<EntityCacheValue<T>>(queryKey);
      const optimisticId = `temp-${generateSecureUUID()}`;
      const optimisticItem = { id: optimisticId, ...payload } as unknown as T;
      queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
        updateEntityCache<T>(old, (items) => [optimisticItem, ...items], 1)
      );
      return { previousData, optimisticId };
    },
    onError: (_err, _variables, context) => {
      restorePreviousCache(context);
    },
    onSuccess: (newItem, _variables, context) => {
      queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) => {
        if (old === undefined) return [newItem];
        return updateEntityCache<T>(old, (items) => {
          if (items.length === 0) return [newItem];
          const exists = items.some(
            (item) => item.id === context?.optimisticId || item.id === newItem.id
          );
          if (exists) {
            return items.map((item) =>
              item.id === context?.optimisticId || item.id === newItem.id ? newItem : item
            );
          }
          return [newItem, ...items];
        });
      });
      invalidateRelatedQueries();
    },
    meta: {
      successMessage: `Created ${entityName} successfully.`,
    },
  });

  const { mutateAsync: updateItem } = useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: Partial<T> }) => {
      const res = await apiClient.put<unknown>(`${endpoint}/${id}`, payload);
      return unwrapEntityResponse<T>(res);
    },
    onMutate: async ({ id, payload }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<EntityCacheValue<T>>(queryKey);
      if (previousData !== undefined) {
        queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
          updateEntityCache<T>(old, (items) =>
            items.map((item) => (item.id === id ? { ...item, ...payload } : item))
          )
        );
      }
      return { previousData };
    },
    onError: (_err, _variables, context) => {
      restorePreviousCache(context);
    },
    onSuccess: (updatedItem) => {
      queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
        updateEntityCache<T>(old, (items) =>
          items.map((item) => (item.id === updatedItem.id ? updatedItem : item))
        )
      );
      invalidateRelatedQueries();
    },
    meta: {
      successMessage: `Updated ${entityName} successfully.`,
    },
  });

  const { mutateAsync: removeItem } = useMutation({
    mutationFn: async (id: string) => apiClient.delete(`${endpoint}/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<EntityCacheValue<T>>(queryKey);
      if (previousData !== undefined) {
        queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
          updateEntityCache<T>(old, (items) => items.filter((item) => item.id !== id), -1)
        );
      }
      return { previousData };
    },
    onSuccess: () => {
      invalidateRelatedQueries();
    },
    onError: (_err, _variables, context) => {
      restorePreviousCache(context);
    },
    meta: {
      successMessage: `Deleted ${entityName} successfully.`,
    },
  });

  const { mutateAsync: removeBatchItems } = useMutation({
    mutationFn: async (ids: string[]) => apiClient.delete(`${endpoint}/batch`, { ids }),
    onMutate: async (ids) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<EntityCacheValue<T>>(queryKey);
      if (previousData !== undefined) {
        const idSet = new Set(ids);
        queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
          updateEntityCache<T>(
            old,
            (items) => items.filter((item) => !idSet.has(item.id)),
            -idSet.size
          )
        );
      }
      return { previousData };
    },
    onSuccess: (_data, ids) => {
      const idSet = new Set(ids);
      queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
        updateEntityCache<T>(old, (items) => items.filter((item) => !idSet.has(item.id)))
      );
      invalidateRelatedQueries();
    },
    onError: (_err, _variables, context) => {
      restorePreviousCache(context);
    },
    meta: {
      successMessage: `Deleted selected ${entityName}s successfully.`,
    },
  });

  const { mutateAsync: updateBatchItems } = useMutation({
    mutationFn: async ({ ids, payload }: { ids: string[]; payload: Partial<T> }) =>
      apiClient.post<unknown>(`${endpoint}/batch`, { ids, ...payload }),
    onMutate: async ({ ids, payload }) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<EntityCacheValue<T>>(queryKey);
      if (previousData !== undefined) {
        const idSet = new Set(ids);
        queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
          updateEntityCache<T>(old, (items) =>
            items.map((item) => (idSet.has(item.id) ? { ...item, ...payload } : item))
          )
        );
      }
      return { previousData };
    },
    onSuccess: (_data, variables) => {
      const idSet = new Set(variables.ids);
      queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
        updateEntityCache<T>(old, (items) =>
          items.map((item) =>
            idSet.has(item.id) ? { ...item, ...variables.payload } : item
          )
        )
      );
      invalidateRelatedQueries();
    },
    onError: (_err, _variables, context) => {
      restorePreviousCache(context);
    },
    meta: {
      successMessage: `Updated selected ${entityName}s successfully.`,
    },
  });

  const { mutateAsync: reorderItems } = useMutation({
    mutationFn: async (orderedIds: string[]) => apiClient.put(endpoint, { action: 'reorder', orderedIds }),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey });
      const previousData = queryClient.getQueryData<EntityCacheValue<T>>(queryKey);
      if (previousData !== undefined) {
        queryClient.setQueryData<EntityCacheValue<T> | undefined>(queryKey, (old) =>
          updateEntityCache<T>(old, (items) => {
            const entityMap = new Map<string, T>(items.map((entity) => [entity.id, entity]));
            const reordered: T[] = [];
            for (const id of orderedIds) {
              const entity = entityMap.get(id);
              if (entity) {
                reordered.push(entity);
                entityMap.delete(id);
              }
            }
            reordered.push(...entityMap.values());
            return reordered;
          })
        );
      }
      return { previousData };
    },
    onSuccess: () => {
      invalidateRelatedQueries();
    },
    onError: (_err, _variables, context) => {
      restorePreviousCache(context);
    },
    meta: {
      successMessage: `Reordered ${entityName} successfully.`,
    },
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
