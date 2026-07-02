import { NextResponse, NextRequest } from 'next/server';
import { mediaRepository } from '@/features/media/repository';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { MediaCreateSchema } from '@/features/media/schemas';

export const GET = withApiMiddleware(async (_request: NextRequest) => {
  const media = await mediaRepository.getAllMedia();
  return NextResponse.json(media);
});

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = MediaCreateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.format() }, { status: 400 });
  }

  const newMedia = await mediaRepository.createMedia(parsed.data);
  return NextResponse.json(newMedia, { status: 201 });
});
