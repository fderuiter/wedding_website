import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { AttractionDTO } from '@/features/attractions';

export function useAdminAttractions(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<AttractionDTO>({
    queryKey: ['admin-attractions'],
    endpoint: '/api/admin/attractions',
    entityName: 'attraction',
    options,
  });
}

