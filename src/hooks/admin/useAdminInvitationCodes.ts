import { useEntityOrchestration } from '../useEntityOrchestration';
import type { InvitationCodeDTO } from '@/features/registry/schemas';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

export function useAdminInvitationCodes() {
  return useEntityOrchestration<InvitationCodeDTO>({
    queryKey: ['admin-invitation-codes'],
    endpoint: '/api/admin/invitation-codes',
    entityName: 'invitation code',
    apiClient,
  });
}
