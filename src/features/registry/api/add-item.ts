import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { RegistryItemBaseSchema, LegacyRegistryItemBaseSchema, translateLegacyToActive, translateActiveToLegacy } from '../schemas';
import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

/**
 * Adds a new item to the registry.
 * 
 * **Response:**
 * *   **`201 Created`** - Returns the newly created `RegistryItem` object.
 *     ```json
 *     {
 *       "id": "clxfa5z...",
 *       "name": "Stand Mixer",
 *       "description": "A powerful stand mixer for all our baking adventures.",
 *       "category": "Kitchen",
 *       "price": 299.99,
 *       "image": "/images/mixer.jpg",
 *       "vendorUrl": "https://example.com/mixer",
 *       "quantity": 1,
 *       "isGroupGift": false,
 *       "purchased": false,
 *       "purchaserName": null,
 *       "amountContributed": 0,
 *       "contributors": []
 *     }
 *     ```
 */
export const POST = createValidatedRoute({
  schema: RegistryItemBaseSchema,
  legacySchema: LegacyRegistryItemBaseSchema,
  translateLegacy: translateLegacyToActive,
  translateActiveToLegacy,
  handler: async (_request: NextRequest, { body }) => {
    const config = await getAppConfig();
    if (!isFeatureEnabled('registry', config.modules)) {
      throw new ApiError(404, "Feature 'registry' is disabled");
    }
    const newItemData = body;

    const newItem = await registryService.createItem({
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
    });

    return NextResponse.json({ message: 'Item added successfully', item: newItem }, { status: 201 });
  }
});
