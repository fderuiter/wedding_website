import { NextRequest, NextResponse } from 'next/server';
import { contentService } from '@/features/content';
import { PhotoModerationSchema } from '@/features/content';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const PATCH = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const { id } = await params;
  const body = await parseJsonRequestBody(request);
  const parsed = PhotoModerationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message || 'Invalid moderation payload');
  }

  const action: 'approve' | 'reject' = parsed.data.action
    ? (String(parsed.data.action).toLowerCase() as 'approve' | 'reject')
    : String(parsed.data.status).toUpperCase() === 'APPROVED'
      ? 'approve'
      : 'reject';

  const hasMetadataOverrides =
    parsed.data.caption !== undefined || parsed.data.uploaderName !== undefined;
  const result = hasMetadataOverrides
    ? await contentService.moderatePhoto(id, action, 'Admin', {
      caption: parsed.data.caption,
      uploaderName: parsed.data.uploaderName,
    })
    : await contentService.moderatePhoto(id, action, 'Admin');

  return NextResponse.json({
    success: true,
    message: `Photo ${action}d successfully`,
    data: result,
  });
});
