import { NextResponse, NextRequest } from 'next/server';
import { registryService } from '@/features/registry/service';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async () => {
  const items = await registryService.getAllItems();
  return NextResponse.json(items);
});
