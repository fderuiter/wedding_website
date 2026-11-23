import { z } from 'zod';
import { RegistryItemBaseSchema } from '../schemas';
import type { CreateRegistryItemInput } from '../types';

type ValidatedRegistryItemPayload = z.infer<typeof RegistryItemBaseSchema>;

/**
 * Module-private mapper converting a validated API payload into a normalized
 * 15-field `CreateRegistryItemInput` object for single and batch registry creation.
 */
export function mapCreateRegistryItemInput(
  newItemData: ValidatedRegistryItemPayload
): CreateRegistryItemInput {
  return {
    itemType: newItemData.itemType,
    paymentHandleType: newItemData.paymentHandleType,
    paymentHandle: newItemData.paymentHandle,
    name: newItemData.name,
    description: newItemData.description || '',
    category: newItemData.category || 'Uncategorized',
    price: newItemData.price,
    imageUrl: newItemData.imageUrl || '/images/placeholder.png',
    imageAlt: newItemData.imageAlt,
    imageDecorative: newItemData.imageDecorative,
    vendorUrl: newItemData.vendorUrl || null,
    quantity: newItemData.quantity,
    isGroupGift: newItemData.isGroupGift || false,
    isMostWanted: newItemData.isMostWanted ?? false,
    displayOrder: newItemData.displayOrder ?? 0,
  };
}
