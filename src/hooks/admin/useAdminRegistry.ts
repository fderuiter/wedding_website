import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { RegistryItem } from '@/features/registry';

export function useAdminRegistry(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<RegistryItem>({
    queryKey: ['admin-registry'],
    endpoint: '/api/registry/items',
    entityName: 'registry item',
    options,
  });
}

