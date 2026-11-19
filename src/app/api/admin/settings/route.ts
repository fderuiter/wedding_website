import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig, toAdminAppConfig, isMultisiteEnabled } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AppConfigSchema, UpdateAppConfigSchema, toAppConfigDbPayload } from '@/features/content';
import { formatZodError } from '@/utils/validation';

function resolveSecretField(
  incoming: string | null | undefined,
  existingValue: string | null | undefined
): string {
  if (typeof incoming === 'string' && incoming.trim().length > 0) {
    return incoming;
  }
  return existingValue ?? '';
}

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const url = new URL(req.url);
  const list = url.searchParams.get('list');
  const id = url.searchParams.get('id');
  const subdomain = url.searchParams.get('subdomain');

  if (list === 'true') {
    if (!isMultisiteEnabled()) {
      const globalConfig = await getAppConfig('global');
      return NextResponse.json([toAdminAppConfig(globalConfig)]);
    }
    const allConfigs = await prisma.appConfig.findMany({
      orderBy: { createdAt: 'desc' }
    });
    return NextResponse.json(allConfigs.map(c => toAdminAppConfig(AppConfigSchema.parse(c))));
  }

  const target = isMultisiteEnabled() ? (id || subdomain || undefined) : 'global';
  const config = await getAppConfig(target);
  return NextResponse.json(toAdminAppConfig(config));
});

export const PUT = withApiMiddleware(async (req: NextRequest) => {
  const url = new URL(req.url);
  const requestedId = url.searchParams.get('id') || 'global';
  if (!isMultisiteEnabled() && requestedId !== 'global') {
    throw new ApiError(400, 'Multi-site features are disabled. Set MULTISITE_ENABLED=true to enable profile management.');
  }
  const targetId = isMultisiteEnabled() ? requestedId : 'global';
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

  const dbPayload = {
    ...toAppConfigDbPayload(validData),
    smtpPass: resolveSecretField(validData.smtpPass, existing.smtpPass),
    resendApiKey: resolveSecretField(validData.resendApiKey, existing.resendApiKey),
    sendgridApiKey: resolveSecretField(validData.sendgridApiKey, existing.sendgridApiKey),
    twilioAuthToken: resolveSecretField(validData.twilioAuthToken, existing.twilioAuthToken),
  };

  const updatedConfig = await prisma.appConfig.update({
    where: { id: targetId },
    data: dbPayload,
  });

  const parsedUpdatedConfig = AppConfigSchema.parse(updatedConfig);

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: targetId,
      data: toPublicAppConfig(parsedUpdatedConfig) as any,
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

  return NextResponse.json(toAdminAppConfig(parsedUpdatedConfig));
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  if (!isMultisiteEnabled()) {
    throw new ApiError(400, 'Multi-site features are disabled. Set MULTISITE_ENABLED=true to enable profile management.');
  }

  const data = await req.json();

  if (data.subdomain) {
    const duplicate = await prisma.appConfig.findUnique({
      where: { subdomain: data.subdomain },
    });
    if (duplicate) {
      throw new ApiError(400, `Subdomain ${data.subdomain} is already in use by another profile`);
    }
  }

  const newId = data.id || `profile-${Math.random().toString(36).slice(2, 11)}`;

  const resolvedPartner1 = data.partner1Name || data.brideName || 'Partner 1';
  const resolvedPartner2 = data.partner2Name || data.groomName || 'Partner 2';

  const parseResult = UpdateAppConfigSchema.safeParse({
    partner1Name: resolvedPartner1,
    partner2Name: resolvedPartner2,
    brideName: resolvedPartner1,
    groomName: resolvedPartner2,
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
    contactEmail: data.contactEmail ?? '',
    faviconUrl: data.faviconUrl ?? '/assets/favicon.png',
    ogImageUrl: data.ogImageUrl ?? '/images/placeholder.png',
    brandMonogram: data.brandMonogram,
    brandLogoUrl: data.brandLogoUrl,
    brandLogoAlt: data.brandLogoAlt,
    seoKeywords: data.seoKeywords ?? '',
    colorPrimary: data.colorPrimary ?? '#B91C1C',
    colorSecondary: data.colorSecondary ?? '#B45309',
    themePreset: data.themePreset ?? 'classic',
    themeTokens: data.themeTokens ?? {},
    layoutContainerMaxWidth: data.layoutContainerMaxWidth,
    layoutGridGap: data.layoutGridGap,
    layoutCardPadding: data.layoutCardPadding,
    layoutBorderRadius: data.layoutBorderRadius,
    timezone: data.timezone ?? 'UTC',
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
      ...toAppConfigDbPayload(validData),
    },
  });

  const parsedCreatedConfig = AppConfigSchema.parse(createdConfig);

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: newId,
      data: toPublicAppConfig(parsedCreatedConfig) as any,
      author: 'Admin',
    }
  });

  revalidatePath('/', 'layout');

  return NextResponse.json(toAdminAppConfig(parsedCreatedConfig));
});
