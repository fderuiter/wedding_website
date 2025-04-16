// Centralized status logic for registry items
import { RegistryItem } from '@/types/registry';

export type RegistryItemStatus = 'available' | 'claimed' | 'fullyFunded';

export function getRegistryItemStatus(item: RegistryItem): RegistryItemStatus {
  if (item.purchased) {
    if (item.isGroupGift) {
      return 'fullyFunded';
    }
    return 'claimed';
  }
  return 'available';
}
