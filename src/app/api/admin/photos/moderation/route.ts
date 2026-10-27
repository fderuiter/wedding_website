import { NextRequest, NextResponse } from 'next/server';
import { contentService } from '@/features/content';
import { PhotoModerationSchema, BatchPhotoModerationSchema } from '@/features/content/schemas';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const url = request.nextUrl || (request.url ? new URL(request.url) : null);
  const pageParam = url?.searchParams?.get('page');
  const limitParam = url?.searchParams?.get('limit');

  const page = pageParam !== null && pageParam !== undefined && pageParam !== '' ? parseInt(pageParam, 10) : undefined;
  const limit = limitParam !== null && limitParam !== undefined && limitParam !== '' ? parseInt(limitParam, 10) : undefined;

  const result: any = await contentService.getPendingPhotos({ page, limit });

  const photos = Array.isArray(result) ? ((result as any).photos || result) : (result?.photos || []);
  const total = typeof result?.total === 'number' ? result.total : photos.length;
  const curPage = result?.page || (page && !isNaN(page) ? page : 1);
  const curLimit = result?.limit || (limit && !isNaN(limit) ? limit : 50);
  const totalPages = typeof result?.totalPages === 'number' ? result.totalPages : (curLimit > 0 ? Math.ceil(total / curLimit) : 1);

  return NextResponse.json({
    success: true,
    pendingCount: total,
    count: photos.length,
    photos: photos,
    data: photos,
    pagination: {
      page: curPage,
      limit: curLimit,
      total: total,
      totalPages: totalPages,
    },
  });
});

export const PATCH = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const body = await request.json();

  const isBatchPayload = Array.isArray(body.ids) || Array.isArray(body.photoIds) || Array.isArray(body.nodeIds) || Array.isArray(body.id);

  if (isBatchPayload) {
    const parsedBatch = BatchPhotoModerationSchema.safeParse(body);
    if (!parsedBatch.success) {
      throw new ApiError(400, 'Invalid moderation batch payload');
    }

    const ids = body.ids || body.photoIds || body.nodeIds || body.id || [];
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
  }

  const parsed = PhotoModerationSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid moderation payload');
  }

  const id = body.id || body.nodeId || body.photoId;
  if (!id) {
    throw new ApiError(400, 'Photo ID (id or nodeId) is required');
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

export const POST = PATCH;

