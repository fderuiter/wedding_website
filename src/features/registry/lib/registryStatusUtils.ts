// Centralized status and multi-quantity capacity logic for registry items
import { RegistryItem } from '../types';

/**
 * @typedef {'available' | 'claimed' | 'fullyFunded'} RegistryItemStatus
 * @description Represents the possible statuses of a registry item.
 */
type RegistryItemStatus = 'available' | 'claimed' | 'fullyFunded';

/**
 * Returns normalized requested unit count (cash/experience funds always have quantity 1).
 */
function getItemQuantity(
  item: Pick<RegistryItem, 'quantity'> & { itemType?: RegistryItem['itemType'] }
): number {
  if (item.itemType === 'CASH_FUND' || item.itemType === 'EXPERIENCE_FUND') {
    return 1;
  }
  const raw = typeof item.quantity === 'number' && Number.isFinite(item.quantity) ? Math.floor(item.quantity) : 1;
  return Math.max(1, raw);
}

/**
 * Returns total target capacity in cents (`unitPriceCents * quantity`).
 */
function getItemTotalTargetCents(
  item: Pick<RegistryItem, 'price' | 'quantity'> & { itemType?: RegistryItem['itemType'] }
): number {
  return Math.round(item.price * 100) * getItemQuantity(item);
}

/**
 * Returns total target capacity in dollars (`price * quantity`).
 */
export function getItemTotalTargetAmount(
  item: Pick<RegistryItem, 'price' | 'quantity'> & { itemType?: RegistryItem['itemType'] }
): number {
  return getItemTotalTargetCents(item) / 100;
}

/**
 * Returns remaining unfunded/unclaimed balance in cents.
 */
function getItemRemainingCents(
  item: Pick<RegistryItem, 'price' | 'quantity' | 'amountContributed'> & {
    itemType?: RegistryItem['itemType'];
  }
): number {
  const contributedCents = Math.round((item.amountContributed || 0) * 100);
  return Math.max(0, getItemTotalTargetCents(item) - contributedCents);
}

/**
 * Returns remaining unfunded/unclaimed balance in dollars.
 */
export function getItemRemainingAmount(
  item: Pick<RegistryItem, 'price' | 'quantity' | 'amountContributed'> & {
    itemType?: RegistryItem['itemType'];
  }
): number {
  return getItemRemainingCents(item) / 100;
}

/**
 * Computes requested, claimed, and remaining unit counts for multi-quantity items.
 */
export function getItemUnitCounts(
  item: Pick<RegistryItem, 'price' | 'quantity' | 'amountContributed' | 'purchased'> & {
    itemType?: RegistryItem['itemType'];
  }
): {
  requestedUnits: number;
  claimedUnits: number;
  remainingUnits: number;
} {
  const requestedUnits = getItemQuantity(item);
  if (item.purchased) {
    return {
      requestedUnits,
      claimedUnits: requestedUnits,
      remainingUnits: 0,
    };
  }
  const unitPriceCents = Math.round(item.price * 100);
  if (unitPriceCents <= 0) {
    return {
      requestedUnits,
      claimedUnits: 0,
      remainingUnits: requestedUnits,
    };
  }
  const contributedCents = Math.round((item.amountContributed || 0) * 100);
  const claimedUnits = Math.min(requestedUnits, Math.floor(contributedCents / unitPriceCents));
  const remainingUnits = Math.max(0, requestedUnits - claimedUnits);
  return {
    requestedUnits,
    claimedUnits,
    remainingUnits,
  };
}

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
