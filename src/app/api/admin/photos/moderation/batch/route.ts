import { NextRequest } from 'next/server';
import { BatchPhotoModerationSchema } from '@/features/content';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { assertJsonContentType } from '@/utils/contentType';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { handleBatchPhotoModeration } from '../batchHandler';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  assertJsonContentType(request);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }

  const parsed = BatchPhotoModerationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid moderation batch payload');
  }

  return handleBatchPhotoModeration(parsed.data);
});
