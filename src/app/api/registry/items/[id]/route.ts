// src/app/api/registry/items/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { RegistryService } from '@/services/registryService';
import { isAdminRequest } from '@/utils/adminAuth.server';

/* ---------- GET ---------- */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const itemId = url.pathname.split('/').pop()!;
  const item = await RegistryService.getItemById(itemId);

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }
  return NextResponse.json(item);
}

/* ---------- PUT ---------- */
export async function PUT(request: NextRequest) {
  const url = new URL(request.url);
  const itemId = url.pathname.split('/').pop()!;

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  if (!body.name || typeof body.price !== 'number' || typeof body.quantity !== 'number') {
    return NextResponse.json(
      { error: 'Missing or invalid required fields (name, price, quantity)' },
      { status: 400 }
    );
  }

  const updatedItem = await RegistryService.updateItem(itemId, {
    ...body,
    price: Number(body.price),
    quantity: Number(body.quantity),
    isGroupGift: body.isGroupGift === true || body.isGroupGift === 'on',
  });

  return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
}

/* ---------- DELETE ---------- */
export async function DELETE(request: NextRequest) {
  const url = new URL(request.url);
  const itemId = url.pathname.split('/').pop()!;

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await RegistryService.deleteItem(itemId);
  return NextResponse.json({ message: 'Item deleted successfully' });
}