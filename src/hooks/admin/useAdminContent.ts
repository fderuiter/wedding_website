import { useEntityOrchestration } from '../useEntityOrchestration';
import type { ContentNodeDTO } from '@/features/content/schemas';
import { apiClient } from '@/lib/admin/apiClient';

export function useAdminContent() {
  return useEntityOrchestration<ContentNodeDTO>({
    queryKey: ['admin-content-nodes'],
    endpoint: '/api/admin/content-nodes',
    entityName: 'content node',
    apiClient,
  });
}
