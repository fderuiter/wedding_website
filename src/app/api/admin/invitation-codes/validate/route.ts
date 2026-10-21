import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { DryRunValidateBatchSchema, DryRunValidateBatchDTO } from '@/features/registry/schemas';
import { InvitationCodeAdminService } from '@/features/registry/invitation-code.admin.service';
import { formatZodError } from '@/utils/validation';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = DryRunValidateBatchSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const { records, collisionStrategy }: DryRunValidateBatchDTO = parseResult.data;
  const service = new InvitationCodeAdminService();

  try {
    const result = await service.dryRunValidateBatch(records, collisionStrategy);
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    if (error.message && error.message.includes('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
});
