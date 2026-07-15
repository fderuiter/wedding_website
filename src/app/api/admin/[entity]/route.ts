import { AdminEntityCreateSchema, AdminEntityReorderSchema } from '@/utils/validation';
import { NextRequest, NextResponse } from 'next/server';
import { getEntityService } from '@/features/admin/registry';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const { searchParams } = new URL(request.url);
  const orderField = searchParams.get('orderBy') || 'createdAt';
  const orderDir = searchParams.get('orderDir') || 'desc';
  
  const records = await serviceData.service.findMany({ orderBy: { [orderField]: orderDir } });
  return NextResponse.json(records);
});

export const POST = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  AdminEntityCreateSchema.safeParse(body);
  
  try {
    const newRecord = await serviceData.service.create(body);
    return NextResponse.json(newRecord, { status: 201 });
  } catch (error: any) {
    if (error.message && error.message.startsWith('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
});

export const PUT = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  
  if (body.action === 'reorder') {
    const parseResult = AdminEntityReorderSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(400, 'Invalid reorder payload');
    }
    await serviceData.service.reorder(parseResult.data.orderedIds);
    return NextResponse.json({ success: true });
  }
  throw new ApiError(400, 'Invalid action');
});
