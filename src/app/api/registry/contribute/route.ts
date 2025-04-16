import { NextResponse } from 'next/server';
import { RegistryService } from '@/services/registryService';
import { validateContributeInput } from '@/utils/validation';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    const validationError = validateContributeInput(data);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { itemId, purchaserName, amount } = data;

    const updatedItem = await RegistryService.contributeToItem(itemId, {
      name: purchaserName,
      amount: Number(amount)
    });

    return NextResponse.json(updatedItem);
  } catch (error) {
    console.error("Error processing contribution:", error);
    let errorMessage = 'Failed to process contribution';
    if (error instanceof Error) {
      errorMessage = error.message;
    }
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
