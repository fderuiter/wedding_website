import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { validateContentNodeInput } from '@/utils/validation';

export async function GET(request: Request) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const nodes = await prisma.contentNode.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(nodes);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch content nodes' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const validationError = validateContentNodeInput(body);
    if (validationError) return NextResponse.json({ error: validationError }, { status: 400 });

    const newNode = await prisma.contentNode.create({
      data: {
        type: body.type,
        tags: body.tags,
        data: body.data,
      }
    });
    return NextResponse.json(newNode, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create content node' }, { status: 500 });
  }
}
