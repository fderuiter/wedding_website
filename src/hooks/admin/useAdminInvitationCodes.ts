import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { InvitationCodeDTO } from '@/features/registry';

export function useAdminInvitationCodes(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<InvitationCodeDTO>({
    queryKey: ['admin-invitation-codes'],
    endpoint: '/api/admin/invitation-codes',
    entityName: 'invitation code',
    options,
  });
}

