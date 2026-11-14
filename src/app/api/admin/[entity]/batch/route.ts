import { NextRequest, NextResponse } from 'next/server';
import { getEntityService } from '@/features/admin';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AdminEntityBatchUpdateSchema, formatZodError } from '@/utils/validation';

async function handleBatchUpdate(
  request: NextRequest,
  context: { params: Promise<{ entity: string }> }
) {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  let body: any;
  try {
    body = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload');
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

  try {
    const updatedRecords = await serviceData.service.updateBatch(ids, updateData);
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
    if (error instanceof ApiError) throw error;
    if (error.message && error.message.startsWith('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
}

export const POST = withApiMiddleware(handleBatchUpdate);
export const PUT = withApiMiddleware(handleBatchUpdate);
export const PATCH = withApiMiddleware(handleBatchUpdate);

export const DELETE = withApiMiddleware(
  async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
    const { entity } = await context.params;
    const serviceData = await getEntityService(entity);
    if (!serviceData) throw new ApiError(404, 'Entity not found');

    let body: any;
    try {
      body = await request.json();
    } catch {
      throw new ApiError(400, 'Invalid JSON payload');
    }

    if (!body || !Array.isArray(body.ids) || body.ids.length === 0) {
      throw new ApiError(400, 'At least one record identifier is required');
    }

    try {
      if (typeof serviceData.service.batchDelete === 'function') {
        const result = await serviceData.service.batchDelete(body.ids);
        return NextResponse.json(result, { status: 200 });
      }

      const results = await serviceData.service.deleteBatch(body.ids);
      return NextResponse.json({ success: true, count: results.length }, { status: 200 });
    } catch (error: any) {
      if (error instanceof ApiError) throw error;
      if (error.message && error.message.startsWith('Validation Error:')) {
        throw new ApiError(400, error.message.replace('Validation Error: ', ''));
      }
      throw error;
    }
  }
);
