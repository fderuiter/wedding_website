import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { BatchCreateRegistryItemsSchema } from '../schemas';
import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

/**
 * Adds multiple items to the registry in an atomic transaction.
 *
 * **Response:**
 * *   **`201 Created`** - Returns the list of created items and count.
 */
export const POST = createValidatedRoute({
  schema: BatchCreateRegistryItemsSchema,
  handler: async (_request: NextRequest, { body }) => {
    const config = await getAppConfig();
    if (!isFeatureEnabled('registry', config.modules)) {
      throw new ApiError(404, "Feature 'registry' is disabled");
    }

    const { items } = body;

    const itemsToCreate = items.map((newItemData: any) => ({
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
    }));

    const createdItems = await registryService.createBatchItems(itemsToCreate);

    return NextResponse.json(
      {
        success: true,
        message: `${createdItems.length} items added successfully`,
        count: createdItems.length,
        items: createdItems,
      },
      { status: 201 }
    );
  },
});
