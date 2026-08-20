import { useEntityOrchestration } from '../useEntityOrchestration';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
import { apiClient } from '@/features/admin';

export function useAdminWeddingParty() {
  return useEntityOrchestration<WeddingPartyMemberDTO>({
    queryKey: ['admin-wedding-party'],
    endpoint: '/api/admin/wedding-party',
    entityName: 'wedding party member',
    apiClient,
  });
}
