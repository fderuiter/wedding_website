import { AdminEntityUpdateSchema } from "@/utils/validation";
import { NextRequest, NextResponse } from 'next/server';
import { getEntityService } from '@/features/admin/registry';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string, id: string }> }) => {
  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const record = await serviceData.service.findById(id);
  if (!record) throw new ApiError(404, 'Not found');
  
  return NextResponse.json(record);
});

export const PUT = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string, id: string }> }) => {
  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  AdminEntityUpdateSchema.safeParse(body);
  
  if (serviceData.config.validateUpdate) {
    const error = serviceData.config.validateUpdate(body);
    if (error) throw new ApiError(400, error);
  }

  const mappedBody = serviceData.config.mapData ? await serviceData.config.mapData(body) : body;
  const updatedRecord = await serviceData.service.update(id, mappedBody);
  
  return NextResponse.json(updatedRecord);
});

export const DELETE = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string, id: string }> }) => {
  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const deletedRecord = await serviceData.service.delete(id);
  return NextResponse.json(deletedRecord);
});
