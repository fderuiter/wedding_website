import { NextResponse, NextRequest } from 'next/server';
import { mediaRepository } from '@/features/media';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { MediaCreateSchema } from '@/features/media';
import { getAppConfig } from '@/lib/config';
import { isFeatureEnabled } from '@/lib/modules';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }
  const url = request.nextUrl || (request.url ? new URL(request.url) : null);
  const pageParam = url?.searchParams?.get('page');
  const limitParam = url?.searchParams?.get('limit');

  const page = pageParam !== null && pageParam !== undefined ? parseInt(pageParam, 10) : undefined;
  const limit = limitParam !== null && limitParam !== undefined ? parseInt(limitParam, 10) : undefined;

  const result = await mediaRepository.getAllMedia({ page, limit });
  return NextResponse.json(result);
});

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }
  const body = await request.json();
  const parsed = MediaCreateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
  }

  const newMedia = await mediaRepository.createMedia(parsed.data);
  return NextResponse.json(newMedia, { status: 201 });
});
