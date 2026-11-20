import { NextResponse, NextRequest } from 'next/server';
import { contentService } from '@/features/content';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

/**
 * @function GET
 * @description Fetches approved public photos for the gallery and live reception slideshow.
 * Backed by contentService.getPublicPhotos() which filters for approved and visible photos.
 *
 * @param {NextRequest} request - The incoming Next.js request.
 * @returns {Promise<NextResponse>} JSON response containing approved photos.
 */
export const GET = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const { searchParams } = new URL(request.url);
  const sinceParam = searchParams.get('since');
  let sinceDate: Date | undefined;

  if (sinceParam) {
    const parsed = new Date(sinceParam);
    if (isNaN(parsed.getTime())) {
      throw new ApiError(400, 'Invalid "since" parameter. Must be a valid ISO 8601 date string.');
    }
    sinceDate = parsed;
  }

  const nodes = await contentService.getPublicPhotos(
    sinceDate ? { since: sinceDate } : { limit: 50 }
  );

  const photos = nodes
    .map((node) => {
      const data = node.data as
        | {
          url?: string;
          title?: string;
          altText?: string;
          caption?: string;
          uploaderName?: string;
          mediaId?: string;
        }
        | undefined;
      const url = data?.url;
      if (!url) return null;
      const caption = data?.caption?.trim() || undefined;
      const uploaderName = data?.uploaderName?.trim() || undefined;
      const fallbackLabel = caption || (uploaderName ? `Photo by ${uploaderName}` : undefined);
      const isGuestUpload = Boolean(node.tags?.includes('guest-upload'));
      return {
        id: node.id,
        url,
        title: caption || data?.title || data?.altText || fallbackLabel || 'Reception Photo',
        altText: data?.altText || caption || data?.title || fallbackLabel || 'Reception Photo',
        ...(caption ? { caption } : {}),
        ...(uploaderName ? { uploaderName } : {}),
        ...(isGuestUpload ? { isGuestUpload: true } : {}),
        createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : undefined,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    success: true,
    photos,
  });
});
