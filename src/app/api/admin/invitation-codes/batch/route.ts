import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  BatchImportInvitationCodesSchema,
  BatchDeleteInvitationCodesSchema,
  type BatchDeleteInvitationCodesDTO,
} from '@/features/registry';
import { InvitationCodeAdminService } from '@/features/registry';
import { AdminEntityBatchUpdateSchema, formatZodError } from '@/utils/validation';

function handleValidationError(error: any): never {
  if (error instanceof ApiError) throw error;
  if (error?.message && error.message.includes('Validation Error:')) {
    throw new ApiError(400, error.message.replace('Validation Error: ', ''));
  }
  throw error;
}

async function handleBatchUpdate(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload.');
  }

  const parseResult = AdminEntityBatchUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const { ids, ...rest } = parseResult.data;
  const updateData =
    rest.payload && typeof rest.payload === 'object' && !Array.isArray(rest.payload)
      ? rest.payload
      : rest;
  const service = new InvitationCodeAdminService();

  try {
    const updatedRecords = await service.updateBatch(ids, updateData, 'Admin');
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

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: any;
  try {
    body = typeof req.clone === 'function' ? await req.clone().json() : await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload.');
  }

  if (body && ('ids' in body || !('records' in body))) {
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
