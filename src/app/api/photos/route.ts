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
 * @param {NextRequest} _request - The incoming Next.js request.
 * @returns {Promise<NextResponse>} JSON response containing approved photos.
 */
export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const nodes = await contentService.getPublicPhotos();

  const photos = nodes
    .map((node) => {
      const data = node.data as { url?: string; title?: string; altText?: string; mediaId?: string } | undefined;
      const url = data?.url;
      if (!url) return null;
      return {
        id: node.id,
        url,
        title: data?.title || data?.altText || 'Reception Photo',
        altText: data?.altText || data?.title || 'Reception Photo',
        createdAt: node.createdAt ? new Date(node.createdAt).toISOString() : undefined,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    success: true,
    photos,
    data: nodes,
  });
});
