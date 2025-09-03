// src/app/api/registry/add-item/route.ts
import { NextResponse } from 'next/server';
import { RegistryService } from '@/services/registryService';
import { validateAddItemInput } from '@/utils/validation';
import { isAdminRequest } from '@/utils/adminAuth.server';

/**
 * @api {post} /api/registry/add-item
 * @description Adds a new item to the wedding registry.
 *
 * This function handles a POST request to create a new registry item. It requires admin
 * authentication. The incoming request body is validated, and if successful, the new item
 * is created in the database via the `RegistryService`.
 *
 * @param {Request} request - The incoming request object, containing the new item data in the JSON body.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns a 201 status with a success message and the created item.
 * On failure (e.g., unauthorized, validation error, server error), it returns an appropriate
 * error message and status code.
 */
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
