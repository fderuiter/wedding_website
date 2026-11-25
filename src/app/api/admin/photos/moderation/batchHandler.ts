import { NextResponse } from 'next/server';
import {
  contentService,
  BatchPhotoModerationSchema,
  type BatchPhotoModerationOverrides,
} from '@/features/content';
import { ApiError } from '@/utils/ApiError';

function resolveModerationAction(payload: Record<string, unknown>): 'approve' | 'reject' {
  if (payload.action) {
    const normalizedAction = String(payload.action).toLowerCase();
    if (normalizedAction === 'approve' || normalizedAction === 'reject') {
      return normalizedAction;
    }
    throw new ApiError(400, "Invalid moderation action. Must be 'approve' or 'reject'");
  }

  if (payload.status) {
    const normalizedStatus = String(payload.status).toUpperCase();
    if (normalizedStatus === 'APPROVED') {
      return 'approve';
    }
    if (normalizedStatus === 'REJECTED') {
      return 'reject';
    }
    throw new ApiError(400, "Invalid moderation action. Must be 'approve' or 'reject'");
  }

  throw new ApiError(400, "Action ('approve' or 'reject') or status ('APPROVED' or 'REJECTED') is required");
}

export async function handleBatchPhotoModeration(body: unknown): Promise<NextResponse> {
  const parsed = BatchPhotoModerationSchema.safeParse(body);
  if (!parsed.success || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'Invalid moderation batch payload');
  }

  const payload = body as Record<string, unknown>;
  const rawIds =
    payload.ids ??
    payload.photoIds ??
    payload.nodeIds ??
    (Array.isArray(payload.id) ? payload.id : undefined) ??
    [];

  if (!Array.isArray(rawIds) || rawIds.length === 0) {
    throw new ApiError(400, 'Photo IDs list (ids, photoIds, or nodeIds) is required');
  }

  if (rawIds.length > 100) {
    throw new ApiError(400, 'Maximum of 100 photos allowed per batch request');
  }

  const ids = rawIds.map((item) => String(item));
  const action = resolveModerationAction(payload);
  const pendingEdits: BatchPhotoModerationOverrides | undefined = parsed.data.pendingEdits;
  const hasPendingEdits =
    pendingEdits !== undefined &&
    pendingEdits !== null &&
    typeof pendingEdits === 'object' &&
    Object.keys(pendingEdits).length > 0;
  const result = hasPendingEdits
    ? await contentService.moderatePhotosBatch(ids, action, 'Admin', pendingEdits)
    : await contentService.moderatePhotosBatch(ids, action, 'Admin');

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
