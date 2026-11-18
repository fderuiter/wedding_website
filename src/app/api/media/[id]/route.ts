import { NextResponse, NextRequest } from 'next/server';
import { z } from 'zod';
import { mediaRepository } from '@/features/media';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { MediaUpdateSchema } from '@/features/media';

export const PUT = withApiMiddleware(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body = await request.json();
  
  const parsed = MediaUpdateSchema.safeParse(body);
  
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: z.formatError(parsed.error) }, { status: 400 });
  }

  const updatedMedia = await mediaRepository.updateMedia(id, parsed.data);
  return NextResponse.json(updatedMedia);
});

export const DELETE = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  await mediaRepository.deleteMedia(id);
  return NextResponse.json({ success: true });
});
