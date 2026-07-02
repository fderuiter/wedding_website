import { useAdminDomain } from './useAdminDomain';
import type { AttractionDTO } from '@/features/attractions/schemas';

export function useAdminAttractions() {
  return useAdminDomain<AttractionDTO>('attractions', 'attraction');
}
