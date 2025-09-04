import { NextResponse } from 'next/server';
import { RegistryService } from '@/services/registryService';

/**
 * @api {get} /api/registry/items
 * @description Retrieves all items from the wedding registry.
 *
 * This function handles a GET request to fetch all registry items from the database
 * via the `RegistryService`.
 *
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns a JSON array of all registry items.
 * On failure, it returns a 500 status with an error message.
 */
export async function GET() {
  try {
    const items = await RegistryService.getAllItems();
    return NextResponse.json(items);
  } catch (error) {
    console.error("Error reading registry items: ", error);
    return NextResponse.json({ error: 'Failed to load registry items' }, { status: 500 });
  }
}
