import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { BatchCreateRegistryItemsSchema } from '../schemas';
import { mapCreateRegistryItemInput } from './mapCreateRegistryItemInput';
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

    const itemsToCreate = items.map((newItemData) =>
      mapCreateRegistryItemInput(newItemData)
    );

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
