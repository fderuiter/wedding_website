import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  MergeInvitationCodesSchema,
  type MergeInvitationCodesDTO,
  InvitationCodeAdminService,
} from '@/features/registry';
import { formatZodError } from '@/utils/validation';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload.');
  }

  const parseResult = MergeInvitationCodesSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const payload: MergeInvitationCodesDTO = parseResult.data;
  const service = new InvitationCodeAdminService();

  try {
    const result = await service.mergeDuplicates(payload.primaryId, payload.secondaryIds, 'Admin');
    return NextResponse.json(result, { status: 200 });
  } catch (error: unknown) {
    if (error instanceof ApiError) throw error;
    if (error instanceof Error && error.message.includes('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
});
