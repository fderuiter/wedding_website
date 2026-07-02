import { useEntityOrchestration } from '../useEntityOrchestration';
import type { RegistryItem } from '@/features/registry/types';
import { apiClient } from '@/lib/admin/apiClient';

export function useAdminRegistry() {
  return useEntityOrchestration<RegistryItem>({
    queryKey: ['admin-registry'],
    endpoint: '/api/registry/items',
    entityName: 'registry item',
    apiClient,
  });
}
