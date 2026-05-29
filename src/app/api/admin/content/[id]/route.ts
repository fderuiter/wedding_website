import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { validateContentNodeInput } from '@/utils/validation';

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const body = await request.json();
    const validationError = validateContentNodeInput(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const updatedNode = await prisma.contentNode.update({
      where: { id },
      data: {
        type: body.type,
        tags: body.tags,
        data: body.data,
      }
    });
    return NextResponse.json(updatedNode);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update content node' }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    await prisma.contentNode.delete({
      where: { id }
    });
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to delete content node' }, { status: 500 });
  }
}
