import { useEntityOrchestration } from '../useEntityOrchestration';
import type { SubEventDTO } from '@/features/sub-events/schemas';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

export function useAdminSubEvents() {
  return useEntityOrchestration<SubEventDTO>({
    queryKey: ['admin-sub-events'],
    endpoint: '/api/admin/sub-events',
    entityName: 'sub-event',
    apiClient,
  });
}
