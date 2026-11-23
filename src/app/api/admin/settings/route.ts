import { NextRequest, NextResponse } from 'next/server';
import { getAppConfig, toPublicAppConfig, toAdminAppConfig, isMultisiteEnabled } from '@/lib/config';
import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { AppConfigSchema, CreateAppConfigProfileSchema, UpdateAppConfigSchema, toAppConfigDbPayload } from '@/features/content';
import { resolveModuleConfig } from '@/lib/modules';
import { stripPresetDefaultTokens } from '@/lib/theme/presets';
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
    return NextResponse.json(
      allConfigs.map((c) => {
        const parsed = AppConfigSchema.parse(c);
        return toAdminAppConfig({
          ...parsed,
          themeTokens: stripPresetDefaultTokens(parsed.themeTokens, parsed.themePreset),
        });
      })
    );
  }

  const target = isMultisiteEnabled() ? (id || subdomain || undefined) : 'global';
  const config = await getAppConfig(target);
  return NextResponse.json(
    toAdminAppConfig({
      ...config,
      themeTokens: stripPresetDefaultTokens(config.themeTokens, config.themePreset),
    })
  );
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

  const incomingModules =
    data && typeof data.modules === 'object' && data.modules !== null && !Array.isArray(data.modules)
      ? (data.modules as Record<string, unknown>)
      : {};
  const existingRawModules =
    typeof (existing as Record<string, unknown>).modules === 'object' &&
    (existing as Record<string, unknown>).modules !== null &&
    !Array.isArray((existing as Record<string, unknown>).modules)
      ? ((existing as Record<string, unknown>).modules as Record<string, unknown>)
      : {};
  const mergedModules = resolveModuleConfig({
    countdown: existing.showCountdown,
    addToCalendar: existing.showAddToCalendar,
    ...existingRawModules,
    ...(data && typeof data.showCountdown === 'boolean' ? { countdown: data.showCountdown } : {}),
    ...(data && typeof data.showAddToCalendar === 'boolean' ? { addToCalendar: data.showAddToCalendar } : {}),
    ...incomingModules,
  });

  const cleanedThemeTokens = stripPresetDefaultTokens(
    validData.themeTokens,
    validData.themePreset,
    existing.themePreset
  );

  const dbPayload = {
    ...toAppConfigDbPayload({
      ...validData,
      themeTokens: cleanedThemeTokens,
    }),
    modules: mergedModules,
    showCountdown: mergedModules.countdown,
    showAddToCalendar: mergedModules.addToCalendar,
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

  await createAuditSnapshot(
    'AppConfig',
    targetId,
    toPublicAppConfig(parsedUpdatedConfig),
    'Admin'
  );

  revalidatePath('/', 'layout');

  return NextResponse.json(toAdminAppConfig(parsedUpdatedConfig));
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  if (!isMultisiteEnabled()) {
    throw new ApiError(400, 'Multi-site features are disabled. Set MULTISITE_ENABLED=true to enable profile management.');
  }

  const data = await req.json();

  const parseResult = CreateAppConfigProfileSchema.safeParse(data);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const validData = parseResult.data;

  if (validData.subdomain) {
    const duplicate = await prisma.appConfig.findUnique({
      where: { subdomain: validData.subdomain },
    });
    if (duplicate) {
      throw new ApiError(400, `Subdomain ${validData.subdomain} is already in use by another profile`);
    }
  }

  const newId = validData.id || `profile-${Math.random().toString(36).slice(2, 11)}`;

  const cleanedCreateTokens = stripPresetDefaultTokens(
    validData.themeTokens,
    validData.themePreset
  );

  const createdConfig = await prisma.appConfig.create({
    data: {
      id: newId,
      ...toAppConfigDbPayload({
        ...validData,
        themeTokens: cleanedCreateTokens,
      }),
    },
  });

  const parsedCreatedConfig = AppConfigSchema.parse(createdConfig);

  await createAuditSnapshot(
    'AppConfig',
    newId,
    toPublicAppConfig(parsedCreatedConfig),
    'Admin'
  );

  revalidatePath('/', 'layout');

  return NextResponse.json(toAdminAppConfig(parsedCreatedConfig));
});
