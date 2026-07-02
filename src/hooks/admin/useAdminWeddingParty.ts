import { useAdminDomain } from './useAdminDomain';
import type { WeddingPartyMemberDTO } from '@/features/wedding-party/schemas';

export function useAdminWeddingParty() {
  return useAdminDomain<WeddingPartyMemberDTO>('wedding-party', 'wedding party member');
}
