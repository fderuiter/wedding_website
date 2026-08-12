import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AppConfigSchema, UpdateAppConfigSchema } from '@/features/content';
import { formatZodError } from '@/utils/validation';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const url = new URL(req.url);
  const list = url.searchParams.get('list');
  const id = url.searchParams.get('id');
  const subdomain = url.searchParams.get('subdomain');

  if (list === 'true') {
    const allConfigs = await prisma.appConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(allConfigs.map(c => toPublicAppConfig(AppConfigSchema.parse(c))));
  }

  const target = id || subdomain || undefined;
  const config = await getAppConfig(target);
  return NextResponse.json(toPublicAppConfig(config));
});

export const PUT = withApiMiddleware(async (req: NextRequest) => {
  const url = new URL(req.url);
  const targetId = url.searchParams.get('id') || 'global';
  const data = await req.json();

  const parseResult = UpdateAppConfigSchema.safeParse(data);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const validData = parseResult.data;

  const existing = await prisma.appConfig.findUnique({
    where: { id: targetId },
  });
  if (!existing) {
    throw new ApiError(404, `Configuration profile with ID ${targetId} not found`);
  }

  if (validData.subdomain && validData.subdomain !== existing.subdomain) {
    const duplicate = await prisma.appConfig.findUnique({
      where: { subdomain: validData.subdomain },
    });
    if (duplicate) {
      throw new ApiError(400, `Subdomain ${validData.subdomain} is already in use by another profile`);
    }
  }

  const updatedConfig = await prisma.appConfig.update({
    where: { id: targetId },
    data: {
      brideName: validData.brideName,
      groomName: validData.groomName,
      subdomain: validData.subdomain || null,
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
      colorPrimary: validData.colorPrimary,
      colorSecondary: validData.colorSecondary,
      timezone: validData.timezone,
      showCountdown: validData.showCountdown,
      showAddToCalendar: validData.showAddToCalendar,
    },
  });

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: targetId,
      data: updatedConfig as any,
      author: 'Admin',
    }
  });
  
  const versions = await prisma.snapshotVersion.findMany({
    where: { entityType: 'AppConfig', entityId: targetId },
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

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const data = await req.json();

  if (data.subdomain) {
    const duplicate = await prisma.appConfig.findUnique({
      where: { subdomain: data.subdomain },
    });
    if (duplicate) {
      throw new ApiError(400, `Subdomain ${data.subdomain} is already in use by another profile`);
    }
  }

  const newId = data.id || `profile-${Math.random().toString(36).substr(2, 9)}`;

  const parseResult = UpdateAppConfigSchema.safeParse({
    brideName: data.brideName ?? 'Bride',
    groomName: data.groomName ?? 'Groom',
    weddingDate: data.weddingDate ?? new Date().toISOString(),
    baseUrl: data.baseUrl ?? '',
    venueName: data.venueName ?? 'TBD Venue',
    venueAddress: data.venueAddress ?? '',
    venueCity: data.venueCity ?? '',
    venueState: data.venueState ?? '',
    venueZip: data.venueZip ?? '',
    latitude: data.latitude ?? 0,
    longitude: data.longitude ?? 0,
    storyText: data.storyText ?? '',
    venueDescription: data.venueDescription ?? '',
    travelAdvice: data.travelAdvice ?? '',
    heroTitle: data.heroTitle ?? '',
    heroSubtitle: data.heroSubtitle ?? '',
    seoTitle: data.seoTitle ?? '',
    seoDescription: data.seoDescription ?? '',
    faviconUrl: data.faviconUrl ?? '/assets/favicon.png',
    ogImageUrl: data.ogImageUrl ?? '/images/sunset-embrace.jpg',
    seoKeywords: data.seoKeywords ?? '',
    colorPrimary: data.colorPrimary ?? '#B91C1C',
    colorSecondary: data.colorSecondary ?? '#B45309',
    timezone: data.timezone ?? 'America/Chicago',
    showCountdown: data.showCountdown ?? true,
    showAddToCalendar: data.showAddToCalendar ?? true,
    subdomain: data.subdomain || null,
  });

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const validData = parseResult.data;

  const createdConfig = await prisma.appConfig.create({
    data: {
      id: newId,
      brideName: validData.brideName,
      groomName: validData.groomName,
      subdomain: validData.subdomain || null,
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
      colorPrimary: validData.colorPrimary,
      colorSecondary: validData.colorSecondary,
      timezone: validData.timezone,
      showCountdown: validData.showCountdown,
      showAddToCalendar: validData.showAddToCalendar,
    },
  });

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: newId,
      data: createdConfig as any,
      author: 'Admin',
    }
  });

  revalidatePath('/', 'layout');

  return NextResponse.json(toPublicAppConfig(AppConfigSchema.parse(createdConfig)));
});
