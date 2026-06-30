import { NextRequest, NextResponse } from 'next/server';
import { getEntityService } from '@/lib/admin/registry';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const GET = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const { searchParams } = new URL(request.url);
  const orderField = searchParams.get('orderBy') || 'createdAt';
  const orderDir = searchParams.get('orderDir') || 'desc';
  
  let orderBy: any = { [orderField]: orderDir };
  if (serviceData.config.entityType === 'WeddingPartyMember') {
     orderBy = { order: 'asc' };
  }
  
  const records = await serviceData.service.findMany({ orderBy });
  return NextResponse.json(records);
});

export const POST = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  
  if (serviceData.config.validateCreate) {
    const error = serviceData.config.validateCreate(body);
    if (error) throw new ApiError(400, error);
  }

  const mappedBody = serviceData.config.mapData ? serviceData.config.mapData(body) : body;
  const newRecord = await serviceData.service.create(mappedBody);
  return NextResponse.json(newRecord, { status: 201 });
});

export const PUT = withApiMiddleware(async (request: NextRequest, context: { params: Promise<{ entity: string }> }) => {
  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) throw new ApiError(404, 'Entity not found');

  const body = await request.json();
  if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
    await serviceData.service.reorder(body.orderedIds);
    return NextResponse.json({ success: true });
  }
  throw new ApiError(400, 'Invalid action');
});
