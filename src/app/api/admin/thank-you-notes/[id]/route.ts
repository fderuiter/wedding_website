import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { UpdateThankYouNoteSchema } from '@/features/registry/schemas';
import { thankYouService } from '@/features/registry/thank-you.service';
import { formatZodError } from '@/utils/validation';

export const PATCH = withApiMiddleware(async (req: NextRequest, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const body = await req.json();

  const parseResult = UpdateThankYouNoteSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const updated = await thankYouService.updateThankYouNote(id, parseResult.data, 'Admin');
  return NextResponse.json({
    success: true,
    ...updated,
  });
});

export const PUT = PATCH;
