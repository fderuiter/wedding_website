import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { createAuditSnapshot } from '@/lib/audit';
import { getAppConfig } from '@/lib/config';
import { sanitizeAppConfigForBackup } from '@/lib/backupPersistence';
import { DEFAULT_MODULE_CONFIG, isFeatureEnabled } from '@/lib/modules';
import { buildSignedPhotoUploadUrl } from '@/core/auth/photoUploadToken';
import { resolveTenantClaimsForSigning } from '@/core/auth/tenantClaims.node';
import { AdminPhotoQrUpdateSchema } from '@/features/content';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import { formatZodError } from '@/utils/validation';
import {
  isHostAllowed,
  resolveRequestHost,
  resolveRequestProtocol,
} from '@/utils/hostValidation';

function resolveRequestOrigin(req: NextRequest, configuredBaseUrl: string | undefined): string {
  const cleanConfigured = configuredBaseUrl?.trim().replace(/\/+$/, '') || '';
  if (cleanConfigured) {
    return cleanConfigured;
  }

  try {
    const parsedUrl = new URL(req.url);
    const candidateHost = resolveRequestHost(req.headers, parsedUrl.host);
    if (candidateHost && isHostAllowed(candidateHost)) {
      const protocol =
        resolveRequestProtocol(req.headers, parsedUrl.protocol) ?? 'http';
      return `${protocol}://${candidateHost}`;
    }
  } catch {
    // Fallback to relative path when origin cannot be derived
  }

  return '';
}

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  const origin = resolveRequestOrigin(req, config.baseUrl);
  const tokenVersion =
    typeof config.guestPhotoQrTokenVersion === 'number' && config.guestPhotoQrTokenVersion >= 1
      ? config.guestPhotoQrTokenVersion
      : 1;
  const tenantClaims = await resolveTenantClaimsForSigning(req, config);
  const { uploadUrl } = await buildSignedPhotoUploadUrl(origin, tokenVersion, tenantClaims);

  return NextResponse.json({
    success: true,
    uploadUrl,
    tokenVersion,
    autoApproveGuestPhotos: Boolean(config.autoApproveGuestPhotos),
  });
});

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const config = await getAppConfig();
  if (!isFeatureEnabled('gallery', config.modules)) {
    throw new ApiError(404, "Feature 'gallery' is disabled");
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON payload');
  }

  const parsed = AdminPhotoQrUpdateSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parsed.error)}`);
  }

  const { action, autoApproveGuestPhotos } = parsed.data;
  const currentVersion =
    typeof config.guestPhotoQrTokenVersion === 'number' && config.guestPhotoQrTokenVersion >= 1
      ? config.guestPhotoQrTokenVersion
      : 1;
  const shouldRotate = action === 'rotate';
  const nextAutoApprove =
    typeof autoApproveGuestPhotos === 'boolean'
      ? autoApproveGuestPhotos
      : Boolean(config.autoApproveGuestPhotos);

  const targetConfigId = config.id || 'global';
  const updatedRow = await prisma.appConfig.upsert({
    where: { id: targetConfigId },
    update: {
      ...(shouldRotate ? { guestPhotoQrTokenVersion: { increment: 1 } } : {}),
      ...(typeof autoApproveGuestPhotos === 'boolean' ? { autoApproveGuestPhotos } : {}),
    },
    create: {
      id: targetConfigId,
      ...(config.subdomain ? { subdomain: config.subdomain } : {}),
      partner1Name: config.partner1Name || '',
      partner2Name: config.partner2Name || '',
      brideName: config.brideName || '',
      groomName: config.groomName || '',
      baseUrl: config.baseUrl || '',
      venueName: config.venueName || '',
      venueAddress: config.venueAddress || '',
      venueCity: config.venueCity || '',
      venueState: config.venueState || '',
      venueZip: config.venueZip || '',
      latitude: config.latitude ?? 0,
      longitude: config.longitude ?? 0,
      venueDescription: config.venueDescription || '',
      seoDescription: config.seoDescription || '',
      contactEmail: config.contactEmail || '',
      photoAlbumUrl: config.photoAlbumUrl || '',
      autoApproveGuestPhotos: nextAutoApprove,
      guestPhotoQrTokenVersion: shouldRotate ? currentVersion + 1 : currentVersion,
      faviconUrl: config.faviconUrl || '/assets/favicon.png',
      ogImageUrl: config.ogImageUrl || '/images/placeholder.png',
      seoKeywords: config.seoKeywords || '',
      colorPrimary: config.colorPrimary || '#B91C1C',
      colorSecondary: config.colorSecondary || '#B45309',
      themePreset: config.themePreset || 'classic',
      themeTokens: config.themeTokens || {},
      modules: config.modules || DEFAULT_MODULE_CONFIG,
      timezone: config.timezone || 'UTC',
      showCountdown: config.showCountdown ?? true,
      showAddToCalendar: config.showAddToCalendar ?? true,
      rsvpOpen: config.rsvpOpen ?? true,
      rsvpDeadlineDate: config.rsvpDeadlineDate || '',
      rsvpGracePeriodHours: config.rsvpGracePeriodHours ?? 0,
      rsvpClosedMessage: config.rsvpClosedMessage || '',
      setupCompleted: config.setupCompleted ?? true,
    },
  });

  if (prisma.snapshotVersion && typeof prisma.snapshotVersion.create === 'function') {
    await createAuditSnapshot(
      'AppConfig',
      updatedRow.id || 'global',
      sanitizeAppConfigForBackup({
        ...config,
        ...updatedRow,
      }),
      'Admin'
    );
  }

  try {
    revalidatePath('/photos');
    revalidatePath('/photos/slideshow');
  } catch {
    // Ignore outside Next.js request context
  }

  const resolvedVersion =
    typeof updatedRow.guestPhotoQrTokenVersion === 'number' &&
    updatedRow.guestPhotoQrTokenVersion >= 1
      ? updatedRow.guestPhotoQrTokenVersion
      : shouldRotate
        ? currentVersion + 1
        : currentVersion;
  const origin = resolveRequestOrigin(req, updatedRow.baseUrl ?? config.baseUrl);
  const tenantClaims = await resolveTenantClaimsForSigning(req, {
    id: updatedRow.id || targetConfigId,
    subdomain: updatedRow.subdomain ?? config.subdomain,
  });
  const { uploadUrl } = await buildSignedPhotoUploadUrl(origin, resolvedVersion, tenantClaims);

  return NextResponse.json({
    success: true,
    uploadUrl,
    tokenVersion: resolvedVersion,
    autoApproveGuestPhotos:
      typeof updatedRow.autoApproveGuestPhotos === 'boolean'
        ? updatedRow.autoApproveGuestPhotos
        : nextAutoApprove,
  });
});
