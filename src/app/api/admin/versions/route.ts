import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function GET(request: Request) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const url = new URL(request.url);
  const entityType = url.searchParams.get('entityType');
  const entityId = url.searchParams.get('entityId');

  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'Missing entityType or entityId' }, { status: 400 });
  }

  try {
    const versions = await prisma.snapshotVersion.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(versions);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch versions' }, { status: 500 });
  }
}
