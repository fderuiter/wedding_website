import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { RegistryItemBaseSchema } from '@/features/registry/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
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
export const POST = withApiMiddleware(async (_request: NextRequest) => {
  const body = await request.json();
  const parseResult = RegistryItemBaseSchema.safeParse(body);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const newItemData = parseResult.data;

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
});
