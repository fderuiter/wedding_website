import { useEntityOrchestration } from '../useEntityOrchestration';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party/schemas';
import { apiClient } from '@/lib/admin/apiClient';

export function useAdminWeddingParty() {
  return useEntityOrchestration<WeddingPartyMemberDTO>({
    queryKey: ['admin-wedding-party'],
    endpoint: '/api/admin/wedding-party',
    entityName: 'wedding party member',
    apiClient,
  });
}
