import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AppConfigSchema, UpdateAppConfigSchema } from '@/features/content';
import { formatZodError } from '@/utils/validation';

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
  return NextResponse.json(toPublicAppConfig(config));
});

export const PUT = withApiMiddleware(async (req: NextRequest) => {
  const data = await req.json();

  const parseResult = UpdateAppConfigSchema.safeParse(data);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const validData = parseResult.data;

  const updatedConfig = await prisma.appConfig.update({
    where: { id: 'global' },
    data: {
      brideName: validData.brideName,
      groomName: validData.groomName,
      weddingDate: validData.weddingDate,
      baseUrl: validData.baseUrl,
      venueName: validData.venueName,
      venueAddress: validData.venueAddress,
      venueCity: validData.venueCity,
      venueState: validData.venueState,
      venueZip: validData.venueZip,
      latitude: validData.latitude,
      longitude: validData.longitude,
      storyText: validData.storyText,
      venueDescription: validData.venueDescription,
      travelAdvice: validData.travelAdvice,
      heroTitle: validData.heroTitle,
      heroSubtitle: validData.heroSubtitle,
      seoTitle: validData.seoTitle,
      seoDescription: validData.seoDescription,
      faviconUrl: validData.faviconUrl,
      ogImageUrl: validData.ogImageUrl,
      seoKeywords: validData.seoKeywords,
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
