import { useEntityOrchestration } from '../useEntityOrchestration';
import type { AttractionDTO } from '@/features/attractions';
import { apiClient } from '@/features/admin';

export function useAdminAttractions(options?: { enabled?: boolean }) {
  return useEntityOrchestration<AttractionDTO>({
    queryKey: ['admin-attractions'],
    endpoint: '/api/admin/attractions',
    entityName: 'attraction',
    apiClient,
    enabled: options?.enabled,
  });
}
