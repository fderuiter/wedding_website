// src/app/api/registry/items/[id]/route.ts
import { NextResponse } from 'next/server';
import { RegistryService } from '@/services/registryService';
import { isAdminRequest } from '@/utils/adminAuth.server';

// GET Handler (Fetch single item)
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const itemId = params.id; // Access params directly
  try {
    const item = await RegistryService.getItemById(itemId);
    if (!item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }
    return NextResponse.json(item);
  } catch (error) {
    console.error("Error fetching item:", error);
    return NextResponse.json({ error: 'Failed to fetch item data' }, { status: 500 });
  }
}

// PUT Handler (Update item)
export async function PUT(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Admin authentication check
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const itemId = params.id; // Access params directly
  try {
    const updatedData = await request.json();
    
    // Basic validation
    if (!updatedData.name || typeof updatedData.price !== 'number' || typeof updatedData.quantity !== 'number') {
      return NextResponse.json({ error: 'Missing or invalid required fields (name, price, quantity)' }, { status: 400 });
    }

    const updatedItem = await RegistryService.updateItem(itemId, {
      ...updatedData,
      price: Number(updatedData.price),
      quantity: Number(updatedData.quantity),
      isGroupGift: updatedData.isGroupGift === true || updatedData.isGroupGift === 'on'
    });

    return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
  } catch (error) {
    console.error("Error updating item:", error);
    let errorMessage = 'Failed to update item';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}

// DELETE Handler
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Admin authentication check
  const isAdmin = await isAdminRequest();
  if (!isAdmin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const itemId = params.id; // Access params directly
  try {
    await RegistryService.deleteItem(itemId);
    return NextResponse.json({ message: 'Item deleted successfully' }, { status: 200 });
  } catch (error) {
    console.error("Error deleting item:", error);
    return NextResponse.json({ error: 'Failed to delete item' }, { status: 500 });
  }
}
