import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig, isSiteInitialized } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AppConfigSchema, UpdateAppConfigSchema, toAppConfigDbPayload } from '@/features/content';
import { formatZodError } from '@/utils/validation';
import { isAdminRequest, setAdminAuthCookie, signAdminToken } from '@/core/auth/auth.server';
import { verifyPassword } from '@/utils/password';
import { env } from '@/env';

import { generateSampleData } from '@/lib/sampleData/generator';

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
  const initialized = isSiteInitialized(config);
  return NextResponse.json({
    success: true,
    initialized,
    requiresSetup: !initialized,
  });
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  const initialized = isSiteInitialized(config);
  const isAdmin = await isAdminRequest(req);

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    // Body can be empty if only headers/cookies sent
  }

  // Replay protection: if already initialized and not authenticated as admin, reject
  if (initialized && !isAdmin) {
    throw new ApiError(403, 'Site is already initialized.');
  }

  // First-run setup authorization check
  if (!initialized && !isAdmin) {
    const password = body.password;
    if (!password) {
      throw new ApiError(401, 'Admin password is required for setup.');
    }
    const adminPassword = env.ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new ApiError(500, 'Admin password not configured in environment.');
    }
    const isMatch = await verifyPassword(password, adminPassword);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid admin password.');
    }
  }

  // Determine if this request is submitting site setup configuration
  const hasConfigPayload = body.brideName !== undefined || body.groomName !== undefined || body.baseUrl !== undefined;

  if (!hasConfigPayload) {
    // Auth-only check for step 1
    const iat = Date.now();
    const exp = iat + 60 * 60 * 8 * 1000;
    const token = await signAdminToken({ isAdmin: true, iat, exp });
    const response = NextResponse.json({ success: true, initialized });
    setAdminAuthCookie(response, token);
    return response;
  }

  // Validate setup configuration payload
  const parseResult = UpdateAppConfigSchema.safeParse({
    brideName: body.brideName ?? '',
    groomName: body.groomName ?? '',
    weddingDate: body.weddingDate ?? new Date().toISOString(),
    baseUrl: body.baseUrl ?? '',
    venueName: body.venueName ?? 'TBD Venue',
    venueAddress: body.venueAddress ?? '',
    venueCity: body.venueCity ?? '',
    venueState: body.venueState ?? '',
    venueZip: body.venueZip ?? '',
    latitude: body.latitude ?? 0,
    longitude: body.longitude ?? 0,
    storyText: body.storyText ?? '',
    venueDescription: body.venueDescription ?? '',
    travelAdvice: body.travelAdvice ?? '',
    heroTitle: body.heroTitle ?? '',
    heroSubtitle: body.heroSubtitle ?? '',
    seoTitle: body.seoTitle ?? '',
    seoDescription: body.seoDescription ?? '',
    faviconUrl: body.faviconUrl ?? '/assets/favicon.png',
    ogImageUrl: body.ogImageUrl ?? '/images/sunset-embrace.jpg',
    brandMonogram: body.brandMonogram,
    brandLogoUrl: body.brandLogoUrl,
    brandLogoAlt: body.brandLogoAlt,
    heroImageUrl: body.heroImageUrl,
    heroImageAlt: body.heroImageAlt,
    brandWatermarkUrl: body.brandWatermarkUrl,
    brandWatermarkAlt: body.brandWatermarkAlt,
    badgeGraphicUrl: body.badgeGraphicUrl,
    badgeGraphicAlt: body.badgeGraphicAlt,
    seoKeywords: body.seoKeywords ?? '',
    colorPrimary: body.colorPrimary ?? '#B91C1C',
    colorSecondary: body.colorSecondary ?? '#B45309',
    themePreset: body.themePreset ?? 'classic',
    themeTokens: body.themeTokens ?? {},
    layoutContainerMaxWidth: body.layoutContainerMaxWidth,
    layoutGridGap: body.layoutGridGap,
    layoutCardPadding: body.layoutCardPadding,
    layoutBorderRadius: body.layoutBorderRadius,
    timezone: body.timezone ?? 'America/Chicago',
    showCountdown: body.showCountdown ?? true,
    showAddToCalendar: body.showAddToCalendar ?? true,
    subdomain: body.subdomain || null,
  });

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const validData = parseResult.data;
  const targetId = 'global';
  const dbPayload = toAppConfigDbPayload(validData);

  const updatedConfig = await prisma.appConfig.upsert({
    where: { id: targetId },
    update: dbPayload,
    create: {
      id: targetId,
      ...dbPayload,
    },
  });

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: targetId,
      data: updatedConfig as any,
      author: 'Admin (Setup)',
    },
  });

  if (body.sampleArchetype !== undefined || body.sampleModules !== undefined) {
    try {
      await generateSampleData({
        archetype: body.sampleArchetype,
        modules: body.sampleModules,
      });
    } catch (sampleErr) {
      console.error('Failed to generate sample data during setup:', sampleErr);
    }
  }

  try {
    revalidatePath('/', 'layout');
  } catch {
    // Ignore in non-Next runtime/test environments
  }

  const iat = Date.now();
  const exp = iat + 60 * 60 * 8 * 1000;
  const token = await signAdminToken({ isAdmin: true, iat, exp });

  const response = NextResponse.json({
    success: true,
    ...toPublicAppConfig(AppConfigSchema.parse(updatedConfig)),
  });
  setAdminAuthCookie(response, token);
  return response;
});
