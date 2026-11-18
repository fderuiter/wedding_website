import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/features/admin';
import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { RegistryItem } from '@/features/registry';

const ADMIN_REGISTRY_LIMIT = 500;

export function useAdminRegistry(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<RegistryItem>({
    queryKey: ['admin-registry'],
    endpoint: '/api/registry/items',
    fetchEndpoint: `/api/registry/items?limit=${ADMIN_REGISTRY_LIMIT}`,
    invalidateQueryKeys: [['registry-items']],
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
      const res = await apiClient.get<RegistryItem | RegistryItem[]>(
        `/api/registry/items/${encodeURIComponent(itemId)}`
      );
      if (Array.isArray(res)) {
        return res.find((item) => item.id === itemId) ?? null;
      }
      return res ?? null;
    },
  });
}

