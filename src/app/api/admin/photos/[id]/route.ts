import { NextRequest, NextResponse } from 'next/server';
import { contentService } from '@/features/content';
import { PhotoModerationSchema } from '@/features/content/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const PATCH = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const { id } = await params;
  const body = await request.json();
  const parsed = PhotoModerationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid moderation payload');
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

  const result = await contentService.moderatePhoto(id, action, 'Admin');

  return NextResponse.json({
    success: true,
    message: `Photo ${action}d successfully`,
    data: result,
  });
});

export const PUT = PATCH;
