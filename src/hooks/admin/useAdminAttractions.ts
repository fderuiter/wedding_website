import { useEntityOrchestration } from '../useEntityOrchestration';
import type { AttractionDTO } from '@/features/attractions/schemas';
import { apiClient } from '@/features/admin/apiClient';

export function useAdminAttractions() {
  return useEntityOrchestration<AttractionDTO>({
    queryKey: ['admin-attractions'],
    endpoint: '/api/admin/attractions',
    entityName: 'attraction',
    apiClient,
  });
}
