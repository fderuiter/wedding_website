import { useEntityOrchestration } from '../useEntityOrchestration';
import type { InvitationCodeDTO } from '@/features/registry';
import { apiClient } from '@/features/admin';

export function useAdminInvitationCodes() {
  return useEntityOrchestration<InvitationCodeDTO>({
    queryKey: ['admin-invitation-codes'],
    endpoint: '/api/admin/invitation-codes',
    entityName: 'invitation code',
    apiClient,
  });
}
