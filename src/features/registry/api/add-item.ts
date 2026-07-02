import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { RegistryItemBaseSchema } from '@/features/registry/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
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
    image: newItemData.image || '/images/placeholder.png',
    vendorUrl: newItemData.vendorUrl || null,
    quantity: newItemData.quantity,
    isGroupGift: newItemData.isGroupGift || false,
  });

  return NextResponse.json({ message: 'Item added successfully', item: newItem }, { status: 201 });
});
