import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { SubEventDTO } from '@/features/sub-events';

export function useAdminSubEvents(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<SubEventDTO>({
    queryKey: ['admin-sub-events'],
    endpoint: '/api/admin/sub-events',
    entityName: 'sub-event',
    options,
  });
}

