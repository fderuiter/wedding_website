import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

function reviveDates(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(obj)) {
    return new Date(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(reviveDates);
  }
  if (typeof obj === 'object') {
    const res: any = {};
    for (const key of Object.keys(obj)) {
      res[key] = reviveDates(obj[key]);
    }
    return res;
  }
  return obj;
}

export async function POST(request: Request) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rawData = await request.json();
    const data = reviveDates(rawData);

    // Validate expected structure loosely
    if (!data.appConfig || !data.registryItem) {
      return NextResponse.json({ error: 'Invalid backup file structure' }, { status: 400 });
    }

    await prisma.$transaction(async (tx) => {
      // Delete in reverse order of dependencies
      await tx.contributor.deleteMany();
      await tx.rsvp.deleteMany();
      await tx.registryItem.deleteMany();
      await tx.guest.deleteMany();
      await tx.attraction.deleteMany();
      await tx.weddingPartyMember.deleteMany();
      await tx.contentNode.deleteMany();
      await tx.snapshotVersion.deleteMany();
      await tx.appConfig.deleteMany();

      // Create in dependency order
      if (data.appConfig?.length) await tx.appConfig.createMany({ data: data.appConfig });
      if (data.contentNode?.length) await tx.contentNode.createMany({ data: data.contentNode });
      if (data.weddingPartyMember?.length) await tx.weddingPartyMember.createMany({ data: data.weddingPartyMember });
      if (data.attraction?.length) await tx.attraction.createMany({ data: data.attraction });
      if (data.guest?.length) await tx.guest.createMany({ data: data.guest });
      if (data.registryItem?.length) await tx.registryItem.createMany({ data: data.registryItem });
      if (data.snapshotVersion?.length) await tx.snapshotVersion.createMany({ data: data.snapshotVersion });
      
      if (data.contributor?.length) await tx.contributor.createMany({ data: data.contributor });
      if (data.rsvp?.length) await tx.rsvp.createMany({ data: data.rsvp });
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Failed to import data:', error);
    return NextResponse.json({ error: error.message || 'Failed to import data' }, { status: 500 });
  }
}
