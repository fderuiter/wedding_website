import { NextResponse } from 'next/server';
import { getEntityService } from '@/lib/admin/registry';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function GET(request: Request, context: { params: Promise<{ entity: string, id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const record = await serviceData.service.findById(id);
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(record);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ entity: string, id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const body = await request.json();
    
    if (serviceData.config.validateUpdate) {
      const error = serviceData.config.validateUpdate(body);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const updatedRecord = await serviceData.service.update(id, body);
    return NextResponse.json(updatedRecord);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ entity: string, id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity, id } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const deletedRecord = await serviceData.service.delete(id);
    return NextResponse.json(deletedRecord);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to delete' }, { status: 500 });
  }
}
