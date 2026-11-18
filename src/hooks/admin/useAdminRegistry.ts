import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import { REGISTRY_MAX_CATALOG_LIMIT } from '@/utils/registryPagination';
import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { RegistryItem } from '@/features/registry';

export function useAdminRegistry(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<RegistryItem>({
    queryKey: ['admin-registry'],
    endpoint: '/api/registry/items',
    fetchEndpoint: `/api/registry/items?limit=${REGISTRY_MAX_CATALOG_LIMIT}`,
    invalidateQueryKeys: [['registry-items'], ['admin-registry-item']],
    entityName: 'registry item',
    options,
  });
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

