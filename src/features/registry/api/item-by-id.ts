import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { RegistryItemBaseSchema } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';

async function assertRegistryEnabled(): Promise<void> {
  const config = await getAppConfig();
  if (!isFeatureEnabled('registry', config.modules)) {
    throw new ApiError(404, "Feature 'registry' is disabled");
  }
}

export const GET = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await assertRegistryEnabled();
  const { id } = await params;
  const isAdmin = await isAdminRequest(request);
  const item = await registryService.getItemById(id, { includeContributors: isAdmin });

  if (!item) {
    throw new ApiError(404, 'Item not found');
  }

  if (!isAdmin) {
    return NextResponse.json(maskRegistryItem(item));
  }
  return NextResponse.json(sanitizeRegistryItem(item));
});

const validatedPutHandler = createValidatedRoute({
  schema: RegistryItemBaseSchema,
  handler: async (_request: NextRequest, { params, body }: { params: { id: string }, body: any }) => {
    const { id } = params;
    const updatedData = body;

    const updatedItem = await registryService.updateItem(id, {
      ...updatedData,
      imageUrl: updatedData.imageUrl === null ? undefined : updatedData.imageUrl,
      isGroupGift: !!updatedData.isGroupGift,
    });

    return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
  }
});

export const PUT = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ id: string }> | { id: string } }) => {
  await assertRegistryEnabled();
  return validatedPutHandler(request, context);
});

export const DELETE = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  await assertRegistryEnabled();
  const { id } = await params;
  await registryService.deleteItem(id);
  return NextResponse.json({ message: 'Item deleted successfully' });
});
