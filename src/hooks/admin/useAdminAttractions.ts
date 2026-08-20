import { useEntityOrchestration } from '../useEntityOrchestration';
import type { AttractionDTO } from '@/features/attractions';
import { apiClient } from '@/features/admin';

export function useAdminAttractions() {
  return useEntityOrchestration<AttractionDTO>({
    queryKey: ['admin-attractions'],
    endpoint: '/api/admin/attractions',
    entityName: 'attraction',
    apiClient,
  });
}
