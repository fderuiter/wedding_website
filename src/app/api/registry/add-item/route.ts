// src/app/api/registry/add-item/route.ts
import { NextResponse } from 'next/server';
import { RegistryService } from '@/services/registryService';
import { validateAddItemInput } from '@/utils/validation';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function POST(request: Request) {
  // Admin authentication check
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const newItemData = await request.json();
    const validationError = validateAddItemInput(newItemData);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const newItem = await RegistryService.createItem({
      name: newItemData.name,
      description: newItemData.description || '',
      category: newItemData.category || 'Uncategorized',
      price: Number(newItemData.price),
      image: newItemData.image || '/images/placeholder.png', // Default placeholder image
      vendorUrl: newItemData.vendorUrl || null,
      quantity: Number(newItemData.quantity),
      isGroupGift: newItemData.isGroupGift || false,
      purchaserName: null,
    });

    return NextResponse.json({ message: 'Item added successfully', item: newItem }, { status: 201 });
  } catch (error) {
    console.error("Error adding item:", error);
    let errorMessage = 'Failed to add item to registry';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
