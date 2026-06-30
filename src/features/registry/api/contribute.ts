import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { validateContributeInput } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const data = await request.json();
  const validationError = validateContributeInput(data);
  if (validationError) {
    throw new ApiError(400, validationError);
  }

  const { itemId, name, amount } = data;

  const updatedItem = await registryService.contributeToItem(itemId, {
    name,
    amount: Number(amount)
  });

  return NextResponse.json(updatedItem);
});
