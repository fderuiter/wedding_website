import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { validateAddItemInput } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const item = await registryService.getItemById(id);

  if (!item) {
    throw new ApiError(404, 'Item not found');
  }
  return NextResponse.json(item);
});

export const PUT = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.json();
  const validationError = validateAddItemInput(body);
  if (validationError) {
    throw new ApiError(400, validationError);
  }

  const updatedItem = await registryService.updateItem(id, {
    ...body,
    price: Number(body.price),
    quantity: Number(body.quantity),
    isGroupGift: body.isGroupGift === true || body.isGroupGift === 'on',
  });

  return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
});

export const DELETE = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await registryService.deleteItem(id);
  return NextResponse.json({ message: 'Item deleted successfully' });
});
