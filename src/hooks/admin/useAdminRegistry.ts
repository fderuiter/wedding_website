import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import { REGISTRY_MAX_CATALOG_LIMIT } from '@/utils/registryPagination';
import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { RegistryItem } from '@/features/registry';

const ADMIN_REGISTRY_QUERY_KEY = ['admin-registry'] as const;
const ADMIN_REGISTRY_ENTITY_ENDPOINT = '/api/admin/registry-items';
const REGISTRY_INVALIDATE_QUERY_KEYS = [['registry-items'], ['admin-registry-item']] as const;

function sortByPriorityAndOrder(items: RegistryItem[]): RegistryItem[] {
  return items
    .map((item, originalIndex) => ({ item, originalIndex }))
    .sort((a, b) => {
      const priorityDiff = Number(Boolean(b.item.isMostWanted)) - Number(Boolean(a.item.isMostWanted));
      if (priorityDiff !== 0) return priorityDiff;
      const orderDiff = (a.item.displayOrder ?? 0) - (b.item.displayOrder ?? 0);
      if (orderDiff !== 0) return orderDiff;
      return a.originalIndex - b.originalIndex;
    })
    .map(({ item }) => item);
}

function unwrapRegistryItemResponse(res: unknown): Partial<RegistryItem> | null {
  if (!res || typeof res !== 'object') return null;
  if ('item' in res && (res as { item?: unknown }).item && typeof (res as { item?: unknown }).item === 'object') {
    return (res as { item: Partial<RegistryItem> }).item;
  }
  return res as Partial<RegistryItem>;
}

export function useAdminRegistry(options?: AdminHookOptions) {
  const queryClient = useQueryClient();
  const orchestration = useAdminEntityOrchestration<RegistryItem>({
    queryKey: ADMIN_REGISTRY_QUERY_KEY,
    endpoint: '/api/registry/items',
    fetchEndpoint: `/api/registry/items?limit=${REGISTRY_MAX_CATALOG_LIMIT}`,
    invalidateQueryKeys: REGISTRY_INVALIDATE_QUERY_KEYS,
    entityName: 'registry item',
    options,
  });

  const invalidateRelatedRegistryQueries = () => {
    for (const key of REGISTRY_INVALIDATE_QUERY_KEYS) {
      queryClient.invalidateQueries({ queryKey: key });
    }
  };

  const { mutateAsync: mutateReorderItems } = useMutation({
    mutationFn: async (orderedIds: string[]) =>
      apiClient.put(ADMIN_REGISTRY_ENTITY_ENDPOINT, {
        action: 'reorder',
        orderedIds,
      }),
    onMutate: async (orderedIds) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_REGISTRY_QUERY_KEY });
      const previousData = queryClient.getQueryData<RegistryItem[]>(ADMIN_REGISTRY_QUERY_KEY);
      if (Array.isArray(previousData)) {
        const itemMap = new Map<string, RegistryItem>(previousData.map((item) => [item.id, item]));
        const reordered: RegistryItem[] = [];
        for (const id of orderedIds) {
          const match = itemMap.get(id);
          if (match) {
            reordered.push({ ...match, displayOrder: reordered.length });
            itemMap.delete(id);
          }
        }
        for (const remaining of itemMap.values()) {
          reordered.push({ ...remaining, displayOrder: reordered.length });
        }
        queryClient.setQueryData<RegistryItem[]>(ADMIN_REGISTRY_QUERY_KEY, reordered);
      }
      return { previousData };
    },
    onError: (_err, _orderedIds, context) => {
      if (context && context.previousData !== undefined) {
        queryClient.setQueryData(ADMIN_REGISTRY_QUERY_KEY, context.previousData);
      }
    },
    onSuccess: () => {
      invalidateRelatedRegistryQueries();
    },
    meta: {
      successMessage: 'Reordered registry items successfully.',
      errorMessage: 'Failed to reorder registry items.',
    },
  });

  const { mutateAsync: mutateToggleMostWanted } = useMutation({
    mutationFn: async ({ id, isMostWanted }: { id: string; isMostWanted: boolean }) => {
      const res = await apiClient.put<unknown>(
        `${ADMIN_REGISTRY_ENTITY_ENDPOINT}/${encodeURIComponent(id)}`,
        { isMostWanted }
      );
      return unwrapRegistryItemResponse(res);
    },
    onMutate: async ({ id, isMostWanted }) => {
      await queryClient.cancelQueries({ queryKey: ADMIN_REGISTRY_QUERY_KEY });
      const previousData = queryClient.getQueryData<RegistryItem[]>(ADMIN_REGISTRY_QUERY_KEY);
      if (Array.isArray(previousData)) {
        queryClient.setQueryData<RegistryItem[]>(
          ADMIN_REGISTRY_QUERY_KEY,
          sortByPriorityAndOrder(
            previousData.map((item) => (item.id === id ? { ...item, isMostWanted } : item))
          )
        );
      }
      return { previousData };
    },
    onError: (_err, _variables, context) => {
      if (context && context.previousData !== undefined) {
        queryClient.setQueryData(ADMIN_REGISTRY_QUERY_KEY, context.previousData);
      }
    },
    onSuccess: (updatedRecord, { id, isMostWanted }) => {
      queryClient.setQueryData<RegistryItem[] | undefined>(
        ADMIN_REGISTRY_QUERY_KEY,
        (old) =>
          Array.isArray(old)
            ? sortByPriorityAndOrder(
              old.map((item) => {
                if (item.id !== id) return item;
                return {
                  ...item,
                  ...(updatedRecord ?? {}),
                  isMostWanted:
                    typeof updatedRecord?.isMostWanted === 'boolean'
                      ? updatedRecord.isMostWanted
                      : isMostWanted,
                  image: updatedRecord?.image ?? item.image,
                  contributors: updatedRecord?.contributors ?? item.contributors,
                };
              })
            )
            : old
      );
      invalidateRelatedRegistryQueries();
    },
    meta: {
      successMessage: 'Updated registry item priority.',
      errorMessage: 'Failed to update registry item priority.',
    },
  });

  const { mutateAsync: mutateContributorAction, isPending: isContributorActionPending } =
    useMutation({
      mutationFn: async ({
        contributorId,
        action,
      }: {
        contributorId: string;
        action: 'confirm' | 'remind' | 'void';
      }) => {
        return apiClient.post<{
          action: 'confirm' | 'remind' | 'void';
          changed: boolean;
          contributor: {
            id: string;
            status: string;
            refundedAmount: number;
            reminderEmailSentAt?: string | null;
          };
          item?: RegistryItem | null;
        }>(`/api/admin/contributors/${encodeURIComponent(contributorId)}/action`, {
          action,
        });
      },
      onSuccess: (response) => {
        if (response?.item && response.item.id) {
          const updatedItem = response.item;
          queryClient.setQueryData<RegistryItem[] | undefined>(
            ADMIN_REGISTRY_QUERY_KEY,
            (old) =>
              Array.isArray(old)
                ? old.map((entry) => (entry.id === updatedItem.id ? updatedItem : entry))
                : old
          );
        } else if (response?.contributor?.id) {
          queryClient.setQueryData<RegistryItem[] | undefined>(
            ADMIN_REGISTRY_QUERY_KEY,
            (old) =>
              Array.isArray(old)
                ? old.map((entry) => ({
                  ...entry,
                  contributors: Array.isArray(entry.contributors)
                    ? entry.contributors.map((c) =>
                      c.id === response.contributor.id
                        ? {
                          ...c,
                          status: response.contributor.status as any,
                          refundedAmount: response.contributor.refundedAmount,
                          reminderEmailSentAt: response.contributor.reminderEmailSentAt,
                        }
                        : c
                    )
                    : entry.contributors,
                }))
                : old
          );
        }
        queryClient.invalidateQueries({ queryKey: ADMIN_REGISTRY_QUERY_KEY });
        invalidateRelatedRegistryQueries();
      },
    });

  return {
    ...orchestration,
    reorderItems: (orderedIds: string[]) => mutateReorderItems(orderedIds),
    toggleMostWanted: (id: string, isMostWanted: boolean) =>
      mutateToggleMostWanted({ id, isMostWanted }),
    performContributorAction: (
      contributorId: string,
      action: 'confirm' | 'remind' | 'void'
    ) => mutateContributorAction({ contributorId, action }),
    isContributorActionPending,
  };
}

export function useAdminRegistryItem(itemId?: string) {
  return useQuery<RegistryItem | null, Error>({
    queryKey: ['admin-registry-item', itemId ?? ''],
    enabled: Boolean(itemId),
    queryFn: async () => {
      if (!itemId) return null;
      const res = await apiClient.get<RegistryItem | RegistryItem[] | { item?: RegistryItem }>(
        `/api/registry/items/${encodeURIComponent(itemId)}`
      );
      if (Array.isArray(res)) {
        return res.find((item) => item.id === itemId) ?? null;
      }
      if (res && typeof res === 'object' && 'item' in res && res.item) {
        return res.item;
      }
      return (res as RegistryItem | null) ?? null;
    },
  });
}

