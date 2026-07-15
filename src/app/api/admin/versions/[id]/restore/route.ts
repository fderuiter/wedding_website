import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { coordinateSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (_request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const version = await prisma.snapshotVersion.findUnique({
    where: { id }
  });

  if (!version) {
    throw new ApiError(404, 'Version not found');
  }

  const snapshotData: any = version.data;

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
      photoId: snapshotData.photoId,
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
      imageId: snapshotData.imageId,
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
      imageId: snapshotData.imageId,
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
  } else if (version.entityType === 'Contributor') {
    const data = {
      name: snapshotData.name,
      email: snapshotData.email,
      isPlusOne: snapshotData.isPlusOne || false,
      amount: snapshotData.amount || 0,
      date: snapshotData.date ? new Date(snapshotData.date) : new Date(),
      registryItemId: snapshotData.registryItemId,
    };
    await prisma.contributor.upsert({
      where: { id: version.entityId },
      update: data,
      create: { id: version.entityId, ...data }
    });
  } else {
    throw new ApiError(400, 'Unsupported entity type');
  }

  await prisma.snapshotVersion.create({
    data: {
      entityType: version.entityType,
      entityId: version.entityId,
      data: snapshotData,
      author: 'Admin (Rollback)',
    }
  });

  return NextResponse.json({ success: true, restoredTo: id });
});
