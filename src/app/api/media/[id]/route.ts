import { NextResponse, NextRequest } from 'next/server';
import { mediaRepository } from '@/features/media/repository';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const PUT = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.json();
  const updatedMedia = await mediaRepository.updateMedia(id, body);
  return NextResponse.json(updatedMedia);
});

export const DELETE = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await mediaRepository.deleteMedia(id);
  return NextResponse.json({ success: true });
});
