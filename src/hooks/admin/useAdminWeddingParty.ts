import { useAdminEntityOrchestration, type AdminHookOptions } from './useAdminEntityOrchestration';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';

export function useAdminWeddingParty(options?: AdminHookOptions) {
  return useAdminEntityOrchestration<WeddingPartyMemberDTO>({
    queryKey: ['admin-wedding-party'],
    endpoint: '/api/admin/wedding-party',
    entityName: 'wedding party member',
    options,
  });
}

