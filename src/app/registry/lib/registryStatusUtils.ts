// Centralized status logic for registry items
import { RegistryItem } from '@/types/registry';

/**
 * @typedef {'available' | 'claimed' | 'fullyFunded'} RegistryItemStatus
 * @description Represents the possible statuses of a registry item.
 */
export type RegistryItemStatus = 'available' | 'claimed' | 'fullyFunded';

/**
 * @function getRegistryItemStatus
 * @description Determines the status of a registry item based on its properties.
 * @param {RegistryItem} item - The registry item to evaluate.
 * @returns {RegistryItemStatus} The calculated status of the item.
 */
export function getRegistryItemStatus(item: RegistryItem): RegistryItemStatus {
  if (item.purchased) {
    if (item.isGroupGift) {
      return 'fullyFunded';
    }
    return 'claimed';
  }
  return 'available';
}
