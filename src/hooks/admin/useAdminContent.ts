import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { ContentNodeDTO } from '@/features/content';

export function useAdminContent(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<ContentNodeDTO>({
    queryKey: ['admin-content-nodes'],
    endpoint: '/api/admin/content-nodes',
    entityName: 'content node',
    options,
  });
}

