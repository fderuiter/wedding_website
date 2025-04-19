// src/app/api/registry/items/[id]/route.ts
import { RegistryService } from '@/services/registryService';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';   // <‑‑ type‑only (optional)

// GET ‑ fetch a single item
export async function GET(
  request: Request,                                // or NextRequest (type‑only import)
  { params }: { params: { id: string } }
) {
  const item = await RegistryService.getItemById(params.id);
  if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  return NextResponse.json(item);
}

// PUT ‑ update an item
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const isAdmin = await isAdminRequest(request);   // pass request if the util needs it
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  if (!body.name || typeof body.price !== 'number' || typeof body.quantity !== 'number') {
    return NextResponse.json(
      { error: 'Missing or invalid required fields (name, price, quantity)' },
      { status: 400 }
    );
  }

  const updatedItem = await RegistryService.updateItem(params.id, {
    ...body,
    price: Number(body.price),
    quantity: Number(body.quantity),
    isGroupGift: body.isGroupGift === true || body.isGroupGift === 'on',
  });

  return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
}

// DELETE ‑ remove an item
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const isAdmin = await isAdminRequest(request);
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  await RegistryService.deleteItem(params.id);
  return NextResponse.json({ message: 'Item deleted successfully' });
}