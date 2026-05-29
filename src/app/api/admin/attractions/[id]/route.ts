import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const params = await props.params;
    const { id } = params;
    const data = await req.json();
    const updated = await prisma.attraction.update({
      where: { id },
      data: {
        name: data.name,
        description: data.description,
        image: data.image,
        category: data.category,
        website: data.website,
        directions: data.directions,
        latitude: parseFloat(data.latitude || 0),
        longitude: parseFloat(data.longitude || 0),
        isVisible: data.isVisible !== false,
      }
    });

    await prisma.snapshotVersion.create({
      data: {
        entityType: 'Attraction',
        entityId: updated.id,
        data: updated as any,
        author: 'Admin',
      }
    });

    return NextResponse.json(updated);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request, props: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const params = await props.params;
    const { id } = params;
    await prisma.attraction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
