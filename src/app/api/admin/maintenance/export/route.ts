import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function GET(request: Request) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const [
      appConfig,
      contentNode,
      weddingPartyMember,
      attraction,
      registryItem,
      contributor,
      guest,
      rsvp,
      snapshotVersion
    ] = await Promise.all([
      prisma.appConfig.findMany(),
      prisma.contentNode.findMany(),
      prisma.weddingPartyMember.findMany(),
      prisma.attraction.findMany(),
      prisma.registryItem.findMany(),
      prisma.contributor.findMany(),
      prisma.guest.findMany(),
      prisma.rsvp.findMany(),
      prisma.snapshotVersion.findMany()
    ]);

    const data = {
      appConfig,
      contentNode,
      weddingPartyMember,
      attraction,
      registryItem,
      contributor,
      guest,
      rsvp,
      snapshotVersion
    };

    return new NextResponse(JSON.stringify(data), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="wedding-backup-${new Date().toISOString().split('T')[0]}.json"`
      }
    });
  } catch (error) {
    console.error('Failed to export data:', error);
    return NextResponse.json({ error: 'Failed to export data' }, { status: 500 });
  }
}
