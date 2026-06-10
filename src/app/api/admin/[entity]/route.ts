import { NextResponse } from 'next/server';
import { getEntityService } from '@/lib/admin/registry';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function GET(request: Request, context: { params: Promise<{ entity: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const { searchParams } = new URL(request.url);
    const orderField = searchParams.get('orderBy') || 'createdAt';
    const orderDir = searchParams.get('orderDir') || 'desc';
    
    // Some entities use order field for natural sorting
    let orderBy: any = { [orderField]: orderDir };
    if (serviceData.config.entityType === 'WeddingPartyMember') {
       orderBy = { order: 'asc' };
    }
    
    const records = await serviceData.service.findMany({ orderBy });
    return NextResponse.json(records);
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to fetch' }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ entity: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const body = await request.json();
    
    if (serviceData.config.validateCreate) {
      const error = serviceData.config.validateCreate(body);
      if (error) return NextResponse.json({ error }, { status: 400 });
    }

    const newRecord = await serviceData.service.create(body);
    return NextResponse.json(newRecord, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to create' }, { status: 500 });
  }
}

export async function PUT(request: Request, context: { params: Promise<{ entity: string }> }) {
  // Use PUT on collection for bulk operations like reorder
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { entity } = await context.params;
  const serviceData = getEntityService(entity);
  if (!serviceData) return NextResponse.json({ error: 'Entity not found' }, { status: 404 });

  try {
    const body = await request.json();
    if (body.action === 'reorder' && Array.isArray(body.orderedIds)) {
      await serviceData.service.reorder(body.orderedIds);
      return NextResponse.json({ success: true });
    }
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Failed to update collection' }, { status: 500 });
  }
}
