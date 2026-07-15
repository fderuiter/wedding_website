import { useEntityOrchestration } from '../useEntityOrchestration';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party';
// eslint-disable-next-line no-restricted-imports
import { apiClient } from '@/features/admin/apiClient';

export function useAdminWeddingParty() {
  return useEntityOrchestration<WeddingPartyMemberDTO>({
    queryKey: ['admin-wedding-party'],
    endpoint: '/api/admin/wedding-party',
    entityName: 'wedding party member',
    apiClient,
  });
}
