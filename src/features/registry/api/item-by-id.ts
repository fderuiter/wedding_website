// src/app/api/registry/items/[id]/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { RegistryService } from '@/features/registry/service';
import { isAdminRequest } from '@/utils/adminAuth.server';

/**
 * @api {get} /api/registry/items/:id
 * @description Retrieves a single registry item by its ID.
 *
 * This function handles a GET request for a specific registry item. It extracts the
 * item ID from the URL and uses the `RegistryService` to fetch the corresponding item
 * from the database.
 *
 * @param {NextRequest} request - The incoming Next.js request object.
 * @param {object} context - The context object containing route parameters.
 * @param {Promise<{ id: string }>} context.params - The dynamic route parameters.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * Returns the item if found, otherwise returns a 404 error.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const item = await RegistryService.getItemById(id);

  if (!item) {
    return NextResponse.json({ error: 'Item not found' }, { status: 404 });
  }
  return NextResponse.json(item);
}

/**
 * @api {put} /api/registry/items/:id
 * @description Updates an existing registry item.
 *
 * This function handles a PUT request to update a specific registry item. It requires
 * admin authentication. It validates the request body and then uses the `RegistryService`
 * to apply the updates to the item in the database.
 *
 * @param {NextRequest} request - The incoming Next.js request object, containing the update data.
 * @param {object} context - The context object containing route parameters.
 * @param {Promise<{ id: string }>} context.params - The dynamic route parameters.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, returns a success message and the updated item.
 * On failure, returns an appropriate error message and status code.
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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

  const updatedItem = await RegistryService.updateItem(id, {
    ...body,
    price: Number(body.price),
    quantity: Number(body.quantity),
    isGroupGift: body.isGroupGift === true || body.isGroupGift === 'on',
  });

  return NextResponse.json({ message: 'Item updated successfully', item: updatedItem });
}

/**
 * @api {delete} /api/registry/items/:id
 * @description Deletes a registry item.
 *
 * This function handles a DELETE request to remove a specific registry item from the
 * database. It requires admin authentication.
 *
 * @param {NextRequest} request - The incoming Next.js request object.
 * @param {object} context - The context object containing route parameters.
 * @param {Promise<{ id: string }>} context.params - The dynamic route parameters.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, returns a success message.
 * On failure (e.g., unauthorized), returns an appropriate error message and status code.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  await RegistryService.deleteItem(id);
  return NextResponse.json({ message: 'Item deleted successfully' });
}
