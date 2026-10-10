import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BatchUpdateThankYouNotesSchema } from '@/features/registry/schemas';
import { thankYouService } from '@/features/registry/thank-you.service';
import { formatZodError } from '@/utils/validation';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();

  const parseResult = BatchUpdateThankYouNotesSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const { ids, status, thankYouSentAt, thankYouNote } = parseResult.data;
  const updatedRecords = await thankYouService.batchUpdateThankYouNotes(
    ids,
    status,
    { thankYouSentAt, thankYouNote },
    'Admin'
  );

  return NextResponse.json({
    success: true,
    updatedCount: updatedRecords.length,
    records: updatedRecords,
  });
});

export const PATCH = POST;
