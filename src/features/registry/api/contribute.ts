import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { ContributionSchema } from '@/features/registry/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (_request: NextRequest) => {
  const data = await request.json();
  const parseResult = ContributionSchema.safeParse(data);
  
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { itemId, name, amount } = parseResult.data;

  const updatedItem = await registryService.contributeToItem(itemId, {
    name,
    amount
  });

  return NextResponse.json(updatedItem);
});
