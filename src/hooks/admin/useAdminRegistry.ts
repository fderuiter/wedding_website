import { useAdminDomain } from './useAdminDomain';
import type { RegistryItem } from '@/features/registry/types';

export function useAdminRegistry() {
  return useAdminDomain<RegistryItem>('registry', 'registry item', '/api/registry/items');
}
