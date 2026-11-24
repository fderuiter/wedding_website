import { UpdateFeaturesSchema, formatZodError } from '@/utils/validation';
import { NextResponse, NextRequest } from 'next/server';
import { contentService } from '@/features/content';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';

export const GET = withApiMiddleware(async () => {
  const features = await contentService.getFeatures();
  return NextResponse.json(features);
});

export const PUT = withApiMiddleware(async (request: NextRequest) => {
  const body = await parseJsonRequestBody<Record<string, unknown>>(request);
  const parseResult = UpdateFeaturesSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  if (!body.features) {
    throw new ApiError(400, 'Features required');
  }

  await contentService.updateFeatures(parseResult.data.features);
  return NextResponse.json({ success: true });
});
