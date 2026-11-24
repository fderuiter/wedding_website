import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { mediaRepository } from '@/features/media';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { MediaUpdateSchema } from '@/features/media';
import { isAdminRequest } from '@/core/auth/auth.server';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';
import { parseJsonRequestBody } from '@/utils/contentType';

export const PUT = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest(request))) {
    throw new ApiError(401, 'Unauthorized');
  }
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }
  const { id } = await params;
  const body = await parseJsonRequestBody(request);
  
  const parsed = MediaUpdateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: z.formatError(parsed.error) }, { status: 400 });
  }

  const updatedMedia = await mediaRepository.updateMedia(id, parsed.data);
  return NextResponse.json(updatedMedia);
});

export const DELETE = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  if (!(await isAdminRequest(request))) {
    throw new ApiError(401, 'Unauthorized');
  }
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }
  const { id } = await params;
  await mediaRepository.deleteMedia(id);
  return NextResponse.json({ success: true });
});
