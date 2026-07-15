import { useEntityOrchestration } from '../useEntityOrchestration';
import type { AttractionDTO } from '@/features/attractions';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

export function useAdminAttractions() {
  return useEntityOrchestration<AttractionDTO>({
    queryKey: ['admin-attractions'],
    endpoint: '/api/admin/attractions',
    entityName: 'attraction',
    apiClient,
  });
}
