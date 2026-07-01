import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { validateAddItemInput } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const newItemData = await request.json();
  const validationError = validateAddItemInput(newItemData);
  if (validationError) {
    throw new ApiError(400, validationError);
  }

  const newItem = await registryService.createItem({
    name: newItemData.name,
    description: newItemData.description || '',
    category: newItemData.category || 'Uncategorized',
    price: Number(newItemData.price),
    image: newItemData.image || '/images/placeholder.png',
    vendorUrl: newItemData.vendorUrl || null,
    quantity: Number(newItemData.quantity),
    isGroupGift: newItemData.isGroupGift || false,
  });

  return NextResponse.json({ message: 'Item added successfully', item: newItem }, { status: 201 });
});
