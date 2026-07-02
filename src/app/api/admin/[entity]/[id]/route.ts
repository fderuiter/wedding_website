import { AdminEntityUpdateSchema } from "@/utils/validation";
import { NextRequest, NextResponse } from 'next/server';
import { getEntityService } from '@/features/admin/registry';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (_request: NextRequest, context: { params: Promise<{ entity: string, id: string }> }) => {
  const { entity, id } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const record = await serviceData.service.findById(id);
  if (!record) throw new ApiError(404, 'Not found');
  
  return NextResponse.json(record);
});

export const PUT = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string, id: string }> }) => {
  const { entity, id } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  AdminEntityUpdateSchema.safeParse(body);
  
  try {
    const updatedRecord = await serviceData.service.update(id, body);
    return NextResponse.json(updatedRecord);
  } catch (error: any) {
    if (error.message && error.message.startsWith('Validation Error:')) {
      throw new ApiError(400, error.message.replace('Validation Error: ', ''));
    }
    throw error;
  }
});

export const DELETE = withApiMiddleware(async (_request: NextRequest, context: { params: Promise<{ entity: string, id: string }> }) => {
  const { entity, id } = await context.params;
  const serviceData = await getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const deletedRecord = await serviceData.service.delete(id);
  return NextResponse.json(deletedRecord);
});
