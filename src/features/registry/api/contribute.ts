import { NextResponse } from 'next/server';
import { RegistryService } from '@/features/registry/service';
import { validateContributeInput } from '@/utils/validation';

/**
 * @api {post} /api/registry/contribute
 * @description Submits a contribution to a registry item.
 *
 * This function handles a POST request to contribute to or claim a registry item.
 * The request body is validated, and if successful, the contribution is recorded
 * in the database via the `RegistryService`. This service handles the logic for
 * updating the item's total contributions and marking it as purchased if necessary.
 *
 * @param {Request} request - The incoming request object, containing the contribution data in the JSON body.
 * @returns {Promise<NextResponse>} A promise that resolves to a `NextResponse` object.
 * On success, it returns the updated registry item.
 * On failure (e.g., validation error, server error), it returns an appropriate
 * error message and status code.
 */
export async function POST(request: Request) {
  try {
    const data = await request.json();
    const validationError = validateContributeInput(data);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { itemId, name, amount } = data;

    const updatedItem = await RegistryService.contributeToItem(itemId, {
      name,
      amount: Number(amount)
    });

    return NextResponse.json(updatedItem);
  } catch (error) {
    console.error("Error processing contribution:", error);
    // Security Fix: Do not expose internal error details to the client
    const errorMessage = 'Failed to process contribution. Please try again later.';
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
