import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { RegistryItemBaseSchema } from '@/features/registry/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const item = await registryService.getItemById(id);

  if (!item) {
    throw new ApiError(404, 'Item not found');
  }
  return NextResponse.json(item);
});

export const PUT = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.json();
  const parseResult = RegistryItemBaseSchema.safeParse(body);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const updatedData = parseResult.data;

  const updatedItem = await registryService.updateItem(id, {
    ...updatedData,
    isGroupGift: !!updatedData.isGroupGift,
  });

  return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
});

export const DELETE = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await registryService.deleteItem(id);
  return NextResponse.json({ message: 'Item deleted successfully' });
});
