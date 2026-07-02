import { DynamicSchema } from "@/utils/validation";
import { NextResponse, NextRequest } from 'next/server';
import { contentService } from '@/features/content/service';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async () => {
  const features = await contentService.getFeatures();
  return NextResponse.json(features);
});

export const PUT = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  DynamicSchema.parse(body);
  if (!body.features) {
    throw new ApiError(400, 'Features required');
  }

  await contentService.updateFeatures(body.features);
  return NextResponse.json({ success: true });
});
