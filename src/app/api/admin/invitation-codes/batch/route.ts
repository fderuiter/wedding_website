import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  BatchImportInvitationCodesSchema,
  BatchDeleteInvitationCodesSchema,
  BatchUpdateInvitationTagsSchema,
  type BatchDeleteInvitationCodesDTO,
  type BatchUpdateInvitationTagsDTO,
  InvitationCodeAdminService,
} from '@/features/registry';
import { formatZodError } from '@/utils/validation';
import { handleBatchUpdate as handleEntityBatchUpdate } from '@/app/api/admin/[entity]/batch/route';

function handleValidationError(error: any): never {
  if (error instanceof ApiError) throw error;
  if (error?.message && error.message.includes('Validation Error:')) {
    throw new ApiError(400, error.message.replace('Validation Error: ', ''));
  }
  throw error;
}

function handleBatchUpdate(req: NextRequest) {
  return handleEntityBatchUpdate(req, {
    params: Promise.resolve({ entity: 'invitation-codes' }),
  });
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: any;
  try {
    body = typeof req.clone === 'function' ? await req.clone().json() : await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload.');
  }

  if (
    body &&
    typeof body === 'object' &&
    !Array.isArray(body) &&
    'ids' in body &&
    'tags' in body &&
    'action' in body
  ) {
    const tagParseResult = BatchUpdateInvitationTagsSchema.safeParse(body);
    if (!tagParseResult.success) {
      throw new ApiError(400, `Validation Error: ${formatZodError(tagParseResult.error)}`);
    }

    const payload: BatchUpdateInvitationTagsDTO = tagParseResult.data;
    const service = new InvitationCodeAdminService();

    try {
      const updatedRecords = await service.batchUpdateTags(
        payload.ids,
        payload.tags,
        payload.action,
        'Admin'
      );
      return NextResponse.json(
        {
          success: true,
          count: updatedRecords.length,
          updatedCount: updatedRecords.length,
          records: updatedRecords,
        },
        { status: 200 }
      );
    } catch (error: any) {
      handleValidationError(error);
    }
  }

  if (body && typeof body === 'object' && ('ids' in body || !('records' in body))) {
    return handleBatchUpdate(req);
  }

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
    if (error?.message && error.message.includes('Duplicate invitation code')) {
      throw new ApiError(400, error.message);
    }
    handleValidationError(error);
  }
});

export const PUT = withApiMiddleware(handleBatchUpdate);
export const PATCH = withApiMiddleware(handleBatchUpdate);

export const DELETE = withApiMiddleware(async (req: NextRequest) => {
  let body;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload.');
  }

  const parseResult = BatchDeleteInvitationCodesSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const payload: BatchDeleteInvitationCodesDTO = parseResult.data;
  const { ids } = payload;
  const service = new InvitationCodeAdminService();

  try {
    const result = await service.batchDelete(ids, 'Admin');
    return NextResponse.json(result, { status: 200 });
  } catch (error: any) {
    handleValidationError(error);
  }
});
