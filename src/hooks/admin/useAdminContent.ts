import { useAdminDomain } from './useAdminDomain';
import type { ContentNodeDTO } from '@/features/content/schemas';

export function useAdminContent() {
  return useAdminDomain<ContentNodeDTO>('content-nodes', 'content node');
}
