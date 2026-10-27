import { NextRequest, NextResponse } from 'next/server';
import { contentService } from '@/features/content';
import { BatchPhotoModerationSchema } from '@/features/content/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body');
  }

  const parsed = BatchPhotoModerationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid moderation batch payload');
  }

  const ids = body.ids || body.photoIds || body.nodeIds || [];
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new ApiError(400, 'Photo IDs list (ids, photoIds, or nodeIds) is required');
  }

  if (ids.length > 100) {
    throw new ApiError(400, 'Maximum of 100 photos allowed per batch request');
  }

  let action: 'approve' | 'reject';
  if (body.action) {
    action = String(body.action).toLowerCase() as 'approve' | 'reject';
  } else if (body.status) {
    action = String(body.status).toUpperCase() === 'APPROVED' ? 'approve' : 'reject';
  } else {
    throw new ApiError(400, "Action ('approve' or 'reject') or status ('APPROVED' or 'REJECTED') is required");
  }

  if (action !== 'approve' && action !== 'reject') {
    throw new ApiError(400, "Invalid moderation action. Must be 'approve' or 'reject'");
  }

  const result = await contentService.moderatePhotosBatch(ids, action, 'Admin');

  return NextResponse.json({
    success: true,
    message: `Batch photo moderation completed: ${result.succeededCount} succeeded, ${result.failedCount} failed`,
    total: result.total,
    succeededCount: result.succeededCount,
    failedCount: result.failedCount,
    results: result.results,
    data: result,
  });
});

export const PATCH = POST;
