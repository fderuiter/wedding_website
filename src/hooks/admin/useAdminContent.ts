import { useEntityOrchestration } from '../useEntityOrchestration';
import type { ContentNodeDTO } from '@/features/content';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

export function useAdminContent() {
  return useEntityOrchestration<ContentNodeDTO>({
    queryKey: ['admin-content-nodes'],
    endpoint: '/api/admin/content-nodes',
    entityName: 'content node',
    apiClient,
  });
}
