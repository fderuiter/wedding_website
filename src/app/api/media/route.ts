import { NextResponse, NextRequest } from 'next/server';
import { mediaRepository } from '@/features/media/repository';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const media = await mediaRepository.getAllMedia();
  return NextResponse.json(media);
});

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  const newMedia = await mediaRepository.createMedia(body);
  return NextResponse.json(newMedia, { status: 201 });
});
