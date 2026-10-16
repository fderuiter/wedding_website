import { useEntityOrchestration } from '../useEntityOrchestration';
import type { RegistryItem } from '@/features/registry';
import { apiClient } from '@/features/admin';

export function useAdminRegistry() {
  return useEntityOrchestration<RegistryItem>({
    queryKey: ['admin-registry'],
    endpoint: '/api/registry/items',
    entityName: 'registry item',
    apiClient,
  });
}
