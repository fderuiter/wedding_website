import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { coordinateSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AppConfigSchema } from '@/features/content';

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
  return NextResponse.json(toPublicAppConfig(config));
});

export const PUT = withApiMiddleware(async (req: NextRequest) => {
  const data = await req.json();

  const parsedLat = coordinateSchema.safeParse(data.latitude);
  const parsedLon = coordinateSchema.safeParse(data.longitude);

  if (!parsedLat.success || !parsedLon.success) {
    throw new ApiError(400, 'Invalid coordinate format. Must be a numeric value or a placeholder.');
  }

  const updatedConfig = await prisma.appConfig.update({
    where: { id: 'global' },
    data: {
      brideName: data.brideName,
      groomName: data.groomName,
      weddingDate: new Date(data.weddingDate),
      baseUrl: data.baseUrl,
      venueName: data.venueName,
      venueAddress: data.venueAddress,
      venueCity: data.venueCity,
      venueState: data.venueState,
      venueZip: data.venueZip,
      latitude: parsedLat.data,
      longitude: parsedLon.data,
      storyText: data.storyText,
      venueDescription: data.venueDescription,
      travelAdvice: data.travelAdvice,
      heroTitle: data.heroTitle,
      heroSubtitle: data.heroSubtitle,
      seoTitle: data.seoTitle,
      seoDescription: data.seoDescription,
      faviconUrl: data.faviconUrl,
      ogImageUrl: data.ogImageUrl,
      seoKeywords: data.seoKeywords,
    },
  });

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: 'global',
      data: updatedConfig as any,
      author: 'Admin',
    }
  });
  
  const versions = await prisma.snapshotVersion.findMany({
    where: { entityType: 'AppConfig', entityId: 'global' },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (versions.length > 50) {
    const idsToDelete = versions.slice(50).map(v => v.id);
    await prisma.snapshotVersion.deleteMany({
      where: { id: { in: idsToDelete } }
    });
  }

  revalidatePath('/', 'layout');

  return NextResponse.json(toPublicAppConfig(AppConfigSchema.parse(updatedConfig)));
});
