import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isAdminRequest } from '@/utils/adminAuth.server';
import { coordinateSchema } from '@/utils/validation';

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
      const data = {
        brideName: snapshotData.brideName ?? '',
        groomName: snapshotData.groomName ?? '',
        weddingDate: snapshotData.weddingDate ? new Date(snapshotData.weddingDate) : new Date(),
        baseUrl: snapshotData.baseUrl ?? '',
        venueName: snapshotData.venueName ?? '',
        venueAddress: snapshotData.venueAddress ?? '',
        venueCity: snapshotData.venueCity ?? '',
        venueState: snapshotData.venueState ?? '',
        venueZip: snapshotData.venueZip ?? '',
        latitude: coordinateSchema.parse(snapshotData.latitude || 0),
        longitude: coordinateSchema.parse(snapshotData.longitude || 0),
        storyText: snapshotData.storyText ?? '',
        venueDescription: snapshotData.venueDescription ?? '',
        travelAdvice: snapshotData.travelAdvice ?? '',
        heroTitle: snapshotData.heroTitle ?? '',
        heroSubtitle: snapshotData.heroSubtitle ?? '',
        seoTitle: snapshotData.seoTitle ?? '',
        seoDescription: snapshotData.seoDescription ?? '',
        themePrimary: snapshotData.themePrimary ?? '#f43f5e',
        themeSecondary: snapshotData.themeSecondary ?? '#fbbf24',
        themeAccent: snapshotData.themeAccent ?? '#e11d48',
        faviconUrl: snapshotData.faviconUrl ?? '/assets/favicon.png',
        ogImageUrl: snapshotData.ogImageUrl ?? '/images/sunset-embrace.jpg',
        seoKeywords: snapshotData.seoKeywords ?? '',
        features: snapshotData.features ?? [],
      };
      await prisma.appConfig.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
      });
    } else if (version.entityType === 'ContentNode') {
      const data = {
        type: snapshotData.type,
        tags: snapshotData.tags || [],
        data: snapshotData.data || {},
      };
      await prisma.contentNode.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
      });
    } else if (version.entityType === 'WeddingPartyMember') {
      const data = {
        name: snapshotData.name,
        role: snapshotData.role,
        bio: snapshotData.bio,
        photo: snapshotData.photo,
        link: snapshotData.link,
        order: snapshotData.order || 0,
      };
      await prisma.weddingPartyMember.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
      });
    } else if (version.entityType === 'Attraction') {
      const data = {
        name: snapshotData.name,
        description: snapshotData.description,
        image: snapshotData.image,
        category: snapshotData.category,
        website: snapshotData.website,
        directions: snapshotData.directions,
        latitude: coordinateSchema.parse(snapshotData.latitude || 0),
        longitude: coordinateSchema.parse(snapshotData.longitude || 0),
        isVisible: snapshotData.isVisible !== false,
      };
      await prisma.attraction.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
      });
    } else if (version.entityType === 'RegistryItem') {
      const data = {
        name: snapshotData.name,
        description: snapshotData.description,
        category: snapshotData.category,
        price: snapshotData.price,
        image: snapshotData.image,
        vendorUrl: snapshotData.vendorUrl,
        quantity: snapshotData.quantity || 1,
        isGroupGift: snapshotData.isGroupGift || false,
        purchased: snapshotData.purchased || false,
        purchaserName: snapshotData.purchaserName,
        amountContributed: snapshotData.amountContributed || 0,
      };
      await prisma.registryItem.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
      });
    } else if (version.entityType === 'Guest') {
      const data = {
        firstName: snapshotData.firstName,
        lastName: snapshotData.lastName,
        email: snapshotData.email,
        isPlusOne: snapshotData.isPlusOne || false,
      };
      await prisma.guest.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
      });
    } else if (version.entityType === 'Rsvp') {
      const data = {
        guestId: snapshotData.guestId,
        attending: snapshotData.attending,
        mealChoice: snapshotData.mealChoice,
        dietaryNotes: snapshotData.dietaryNotes,
      };
      await prisma.rsvp.upsert({
        where: { id: version.entityId },
        update: data,
        create: { id: version.entityId, ...data }
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
