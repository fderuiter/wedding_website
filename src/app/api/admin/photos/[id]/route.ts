import { NextRequest, NextResponse } from 'next/server';
import { contentService } from '@/features/content';
import { PhotoModerationSchema } from '@/features/content';
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
    throw new ApiError(400, parsed.error.issues[0]?.message || 'Invalid moderation payload');
  }

  const action: 'approve' | 'reject' = parsed.data.action
    ? (String(parsed.data.action).toLowerCase() as 'approve' | 'reject')
    : String(parsed.data.status).toUpperCase() === 'APPROVED'
      ? 'approve'
      : 'reject';

  const result = await contentService.moderatePhoto(id, action, 'Admin');

  return NextResponse.json({
    success: true,
    message: `Photo ${action}d successfully`,
    data: result,
  });
});
