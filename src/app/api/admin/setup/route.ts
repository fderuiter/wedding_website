import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import {
  getAppConfig,
  toPublicAppConfig,
  sanitizeAppConfigForBackup,
  isSiteInitialized,
  isSetupCompleted,
} from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { revalidatePath } from 'next/cache';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  AppConfigSchema,
  UpdateAppConfigSchema,
  toAppConfigDbPayload,
} from '@/features/content';
import { stripPresetDefaultTokens } from '@/lib/theme/presets';
import { AdminSetupSchema, formatZodError } from '@/utils/validation';
import {
  isAdminRequest,
  setAdminAuthCookie,
  signAdminToken,
} from '@/core/auth/auth.server';
import { verifyPassword } from '@/utils/password';
import { env } from '@/env';

import { generateSampleData } from '@/lib/sampleData/generator';

type SetupRequestPayload = z.infer<typeof AdminSetupSchema> & {
  modules?: unknown;
};

const RESERVED_PARTNER_PLACEHOLDERS = new Set(['partner 1', 'partner 2']);

function fallbackVenueField(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function normalizeOptionalName(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isReservedPartnerPair(
  partner1Name: string,
  partner2Name: string,
): boolean {
  const p1Lower = partner1Name.trim().toLowerCase();
  const p2Lower = partner2Name.trim().toLowerCase();
  return (
    RESERVED_PARTNER_PLACEHOLDERS.has(p1Lower) ||
    RESERVED_PARTNER_PLACEHOLDERS.has(p2Lower) ||
    (p1Lower === 'abbigayle' && p2Lower === 'frederick')
  );
}

function isReservedBaseUrl(url: string): boolean {
  const trimmed = url.trim();
  if (!trimmed) return true;
  if (trimmed.toLowerCase().includes('wedding.example')) return true;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    return (
      host === 'wedding.example' ||
      host.endsWith('.wedding.example') ||
      host === 'example.com' ||
      host.endsWith('.example.com')
    );
  } catch {
    return true;
  }
}

export const GET = withApiMiddleware(async () => {
  const config = await getAppConfig();
  const initialized = isSiteInitialized(config);
  const setupCompleted = isSetupCompleted(config);
  return NextResponse.json({
    success: true,
    initialized,
    setupCompleted,
    requiresSetup: !initialized || !setupCompleted,
  });
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  const initialized = isSiteInitialized(config);
  const isAdmin = await isAdminRequest(req);

  let rawBody: unknown = {};
  try {
    rawBody = await req.json();
  } catch {
    // Body can be empty if only headers/cookies sent
  }

  // Replay protection: if already initialized and not authenticated as admin, reject
  if (initialized && !isAdmin) {
    throw new ApiError(403, 'Site is already initialized.');
  }

  // First-run setup authorization check
  if (!initialized && !isAdmin) {
    const rawPassword =
      rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>).password
        : undefined;
    if (!rawPassword || typeof rawPassword !== 'string') {
      throw new ApiError(
        401,
        !rawPassword
          ? 'Admin password is required for setup.'
          : 'Invalid admin password.',
      );
    }
    const adminPassword = env.ADMIN_PASSWORD;
    if (!adminPassword) {
      throw new ApiError(500, 'Admin password not configured in environment.');
    }
    const isMatch = await verifyPassword(rawPassword, adminPassword);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid admin password.');
    }
  }

  const setupBodyResult = AdminSetupSchema.safeParse(rawBody);
  if (!setupBodyResult.success) {
    throw new ApiError(
      400,
      `Validation Error: ${formatZodError(setupBodyResult.error)}`,
    );
  }

  const body: SetupRequestPayload = {
    ...(rawBody as Record<string, unknown>),
    ...setupBodyResult.data,
  };

  // Determine if this request is submitting site setup configuration
  const hasConfigPayload =
    body.partner1Name !== undefined ||
    body.partner2Name !== undefined ||
    body.brideName !== undefined ||
    body.groomName !== undefined ||
    body.baseUrl !== undefined ||
    body.contactEmail !== undefined;

  if (!hasConfigPayload) {
    if (initialized && isAdmin && typeof body.setupCompleted === 'boolean') {
      await prisma.appConfig.upsert({
        where: { id: 'global' },
        update: { setupCompleted: body.setupCompleted },
        create: { id: 'global', setupCompleted: body.setupCompleted },
      });

      try {
        revalidatePath('/', 'layout');
        revalidatePath('/admin/setup');
        revalidatePath('/admin/dashboard');
      } catch {
        // Ignore in non-Next runtime/test environments
      }

      const iat = Date.now();
      const exp = iat + 60 * 60 * 8 * 1000;
      const token = await signAdminToken({ isAdmin: true, iat, exp });
      const response = NextResponse.json({
        success: true,
        initialized: true,
        setupCompleted: body.setupCompleted,
        requiresSetup: !body.setupCompleted,
      });
      setAdminAuthCookie(response, token);
      return response;
    }

    // Auth-only check for step 1
    const iat = Date.now();
    const exp = iat + 60 * 60 * 8 * 1000;
    const token = await signAdminToken({ isAdmin: true, iat, exp });
    const completed = isSetupCompleted(config);
    const response = NextResponse.json({
      success: true,
      initialized,
      setupCompleted: completed,
      requiresSetup: !initialized || !completed,
    });
    setAdminAuthCookie(response, token);
    return response;
  }

  const requestedSetupCompleted =
    typeof body.setupCompleted === 'boolean' ? body.setupCompleted : true;

  // Validate setup configuration payload
  const normalizedSetupConfig = {
    partner1Name: normalizeOptionalName(body.partner1Name),
    partner2Name: normalizeOptionalName(body.partner2Name),
    brideName: normalizeOptionalName(body.brideName),
    groomName: normalizeOptionalName(body.groomName),
    weddingDate: body.weddingDate ?? new Date().toISOString(),
    baseUrl:
      typeof body.baseUrl === 'string'
        ? body.baseUrl.trim()
        : (body.baseUrl ?? ''),
    ...(body.contactEmail !== undefined
      ? {
        contactEmail:
          typeof body.contactEmail === 'string'
            ? body.contactEmail.trim()
            : body.contactEmail,
      }
      : {}),
    venueName: fallbackVenueField(body.venueName),
    venueAddress: fallbackVenueField(body.venueAddress),
    venueCity: fallbackVenueField(body.venueCity),
    venueState: fallbackVenueField(body.venueState),
    venueZip: fallbackVenueField(body.venueZip),
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
    themeTokens: stripPresetDefaultTokens(
      body.themeTokens ?? {},
      body.themePreset ?? 'classic',
      config.themePreset,
    ),
    layoutContainerMaxWidth: body.layoutContainerMaxWidth,
    layoutGridGap: body.layoutGridGap,
    layoutCardPadding: body.layoutCardPadding,
    layoutBorderRadius: body.layoutBorderRadius,
    timezone: body.timezone ?? 'America/Chicago',
    showCountdown: body.showCountdown ?? config.showCountdown ?? true,
    showAddToCalendar:
      body.showAddToCalendar ?? config.showAddToCalendar ?? true,
    setupCompleted: requestedSetupCompleted,
    modules: body.modules ?? config.modules,
    subdomain: body.subdomain || null,
  };
  const parseResult = UpdateAppConfigSchema.safeParse(normalizedSetupConfig);

  if (!parseResult.success) {
    throw new ApiError(
      400,
      `Validation Error: ${formatZodError(parseResult.error)}`,
    );
  }

  const validData = parseResult.data;

  if (!validData.partner1Name.trim() || !validData.partner2Name.trim()) {
    throw new ApiError(
      400,
      'Validation Error: Partner names are required to complete setup.',
    );
  }
  if (isReservedPartnerPair(validData.partner1Name, validData.partner2Name)) {
    throw new ApiError(
      400,
      'Validation Error: Partner names cannot use reserved placeholder values.',
    );
  }
  if (!validData.baseUrl.trim()) {
    throw new ApiError(
      400,
      'Validation Error: Site base URL is required to complete setup.',
    );
  }
  if (isReservedBaseUrl(validData.baseUrl)) {
    throw new ApiError(
      400,
      'Validation Error: Site base URL cannot use a reserved placeholder domain.',
    );
  }
  if (
    validData.contactEmail &&
    validData.contactEmail.trim().toLowerCase() === 'hosts@wedding.example'
  ) {
    throw new ApiError(
      400,
      'Validation Error: Contact email cannot use a reserved placeholder address.',
    );
  }

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

  const parsedUpdatedConfig = AppConfigSchema.parse(updatedConfig);

  await prisma.snapshotVersion.create({
    data: {
      entityType: 'AppConfig',
      entityId: targetId,
      data: sanitizeAppConfigForBackup(
        parsedUpdatedConfig,
      ) as Prisma.InputJsonValue,
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
    revalidatePath('/admin/setup');
    revalidatePath('/admin/dashboard');
  } catch {
    // Ignore in non-Next runtime/test environments
  }

  const iat = Date.now();
  const exp = iat + 60 * 60 * 8 * 1000;
  const token = await signAdminToken({ isAdmin: true, iat, exp });

  const response = NextResponse.json({
    success: true,
    ...toPublicAppConfig(parsedUpdatedConfig),
    setupCompleted: parsedUpdatedConfig.setupCompleted !== false,
  });
  setAdminAuthCookie(response, token);
  return response;
});
