import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '../service';
import { RegistryItemBaseSchema, LegacyRegistryItemBaseSchema, translateLegacyToActive } from '../schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { createValidatedRoute } from '@/utils/createValidatedRoute';
import { isAdminRequest } from '@/core/auth/auth.server';
import { maskRegistryItem, sanitizeRegistryItem } from '../lib/masking';

export const GET = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const item = await registryService.getItemById(id);

  if (!item) {
    throw new ApiError(404, 'Item not found');
  }

  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) {
    return NextResponse.json(maskRegistryItem(item));
  }
  return NextResponse.json(sanitizeRegistryItem(item));
});

export const PUT = createValidatedRoute({
  schema: RegistryItemBaseSchema,
  legacySchema: LegacyRegistryItemBaseSchema,
  translateLegacy: translateLegacyToActive,
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

export const DELETE = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await registryService.deleteItem(id);
  return NextResponse.json({ message: 'Item deleted successfully' });
});
