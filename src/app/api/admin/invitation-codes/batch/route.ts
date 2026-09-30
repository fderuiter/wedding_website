import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { BatchImportInvitationCodesSchema } from '@/features/registry/schemas';
import { InvitationCodeAdminService } from '@/features/registry/invitation-code.admin.service';
import { formatZodError } from '@/utils/validation';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const body = await req.json();
  const parseResult = BatchImportInvitationCodesSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const { records, collisionStrategy } = parseResult.data;
  const service = new InvitationCodeAdminService();

  try {
    const result = await service.importBatch(records, collisionStrategy, 'Admin');
    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    if (error.message && error.message.includes('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    if (error.message && error.message.includes('Duplicate invitation code')) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
});
