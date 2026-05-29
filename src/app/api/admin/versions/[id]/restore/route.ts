import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const isAdmin = await isAdminRequest();
  if (!isAdmin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { id } = await params;
    const version = await prisma.snapshotVersion.findUnique({
      where: { id }
    });

    if (!version) {
      return NextResponse.json({ error: 'Version not found' }, { status: 404 });
    }

    const snapshotData: any = version.data;

    // Based on entityType, we restore the main record
    if (version.entityType === 'AppConfig') {
      await prisma.appConfig.update({
        where: { id: version.entityId },
        data: {
          brideName: snapshotData.brideName,
          groomName: snapshotData.groomName,
          weddingDate: new Date(snapshotData.weddingDate),
          baseUrl: snapshotData.baseUrl,
          venueName: snapshotData.venueName,
          venueAddress: snapshotData.venueAddress,
          venueCity: snapshotData.venueCity,
          venueState: snapshotData.venueState,
          venueZip: snapshotData.venueZip,
          latitude: parseFloat(snapshotData.latitude),
          longitude: parseFloat(snapshotData.longitude),
          storyText: snapshotData.storyText,
          venueDescription: snapshotData.venueDescription,
          travelAdvice: snapshotData.travelAdvice,
          heroTitle: snapshotData.heroTitle,
          heroSubtitle: snapshotData.heroSubtitle,
          seoTitle: snapshotData.seoTitle,
          seoDescription: snapshotData.seoDescription,
        }
      });
    } else if (version.entityType === 'ContentNode') {
      await prisma.contentNode.update({
        where: { id: version.entityId },
        data: {
          type: snapshotData.type,
          tags: snapshotData.tags,
          data: snapshotData.data,
        }
      });
    } else if (version.entityType === 'WeddingPartyMember') {
      await prisma.weddingPartyMember.update({
        where: { id: version.entityId },
        data: {
          name: snapshotData.name,
          role: snapshotData.role,
          bio: snapshotData.bio,
          photo: snapshotData.photo,
          link: snapshotData.link,
          order: snapshotData.order,
        }
      });
    } else if (version.entityType === 'Attraction') {
      await prisma.attraction.update({
        where: { id: version.entityId },
        data: {
          name: snapshotData.name,
          description: snapshotData.description,
          image: snapshotData.image,
          category: snapshotData.category,
          website: snapshotData.website,
          directions: snapshotData.directions,
          latitude: parseFloat(snapshotData.latitude || 0),
          longitude: parseFloat(snapshotData.longitude || 0),
          isVisible: snapshotData.isVisible !== false,
        }
      });
    } else {
      return NextResponse.json({ error: 'Unsupported entity type' }, { status: 400 });
    }

    // Optionally create a new snapshot stating it was a rollback
    await prisma.snapshotVersion.create({
      data: {
        entityType: version.entityType,
        entityId: version.entityId,
        data: snapshotData,
        author: 'Admin (Rollback)',
      }
    });

    return NextResponse.json({ success: true, restoredTo: id });
  } catch (error) {
    console.error('Failed to restore version:', error);
    return NextResponse.json({ error: 'Failed to restore version' }, { status: 500 });
  }
}
