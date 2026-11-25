import { NextRequest, NextResponse } from 'next/server';
import { getStorageProvider, type LocalUploadStreamResult } from '@/utils/storage';
import { PathContainmentError } from '@/utils/pathContainment';
import { rateLimit } from '@/utils/rateLimit';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import {
  getActivePhotoUploadSession,
  getGuestInviteSession,
} from '@/core/auth/guestInviteSession';
import { getAppConfig } from '@/lib/config';
import { stripBasePath } from '@/lib/basePath';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

const BASE_SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  Vary: 'Cookie',
};

function createErrorResponse(status: number, message: string, headOnly: boolean): NextResponse {
  if (headOnly) {
    return new NextResponse(null, {
      status,
      headers: BASE_SECURITY_HEADERS,
    });
  }
  return NextResponse.json(
    { error: message },
    {
      status,
      headers: BASE_SECURITY_HEADERS,
    }
  );
}

function validateRawRequestPathname(rawUrl: string): void {
  const pathname = new URL(rawUrl).pathname;
  if (
    pathname.includes('\0') ||
    pathname.includes('\\') ||
    /%(?:00|2e|2f|5c)/i.test(pathname) ||
    pathname.includes('//')
  ) {
    throw new PathContainmentError('Upload path contains disallowed or encoded traversal sequences');
  }

  const rawSegments = pathname.split('/').filter(Boolean);
  for (const segment of rawSegments) {
    if (segment === '.' || segment === '..') {
      throw new PathContainmentError('Upload path traversal segment is forbidden');
    }
  }
}

function buildUploadKey(pathSegments: string[] | undefined): string {
  if (!Array.isArray(pathSegments) || pathSegments.length === 0) {
    throw new PathContainmentError('Upload asset path is required');
  }

  for (const segment of pathSegments) {
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('/') ||
      segment.includes('\\') ||
      segment.includes('\0')
    ) {
      throw new PathContainmentError('Invalid upload path segment');
    }
  }

  return `uploads/${pathSegments.join('/')}`;
}

function normalizeCandidateAssetPath(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) {
    return null;
  }

  let pathname = trimmed;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      pathname = new URL(trimmed).pathname;
    } catch {
      return null;
    }
  } else {
    pathname = trimmed.split('?')[0].split('#')[0];
  }

  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const stripped = stripBasePath(withLeadingSlash);
  if (stripped.startsWith('/uploads/')) {
    return stripped;
  }
  const uploadsIdx = stripped.indexOf('/uploads/');
  if (uploadsIdx !== -1 && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))) {
    return stripped.slice(uploadsIdx);
  }
  return stripped;
}

interface UploadAccessResolution {
  allowed: boolean;
  cacheControl: string;
}

async function resolveUploadAccessAndCachePolicy(options: {
  storageKey: string;
  normalizedUploadUrl: string;
  isPhotoUploadPath: boolean;
  isAdmin: boolean;
  isPublicBrandingAsset: boolean;
  isConfiguredSiteAsset: boolean;
}): Promise<UploadAccessResolution> {
  const {
    storageKey,
    normalizedUploadUrl,
    isPhotoUploadPath,
    isAdmin,
    isPublicBrandingAsset,
    isConfiguredSiteAsset,
  } = options;

  const [photoNodes, mediaRows] = await Promise.all([
    prisma.contentNode.findMany({
      where: {
        type: 'Photo',
        OR: [
          { data: { path: ['url'], equals: normalizedUploadUrl } },
          { data: { path: ['url'], equals: storageKey } },
          { data: { path: ['url'], string_ends_with: normalizedUploadUrl } },
        ],
      },
      select: { data: true },
    }),
    isAdmin
      ? Promise.resolve([])
      : prisma.media.findMany({
        where: {
          OR: [
            { url: normalizedUploadUrl },
            { url: storageKey },
            { url: { endsWith: normalizedUploadUrl } },
          ],
        },
        select: { id: true, url: true },
      }),
  ]);

  const matchingPhotoData = photoNodes
    .map((node) =>
      node.data && typeof node.data === 'object' && !Array.isArray(node.data)
        ? (node.data as Record<string, unknown>)
        : null
    )
    .filter(
      (data): data is Record<string, unknown> =>
        data !== null &&
        typeof data.url === 'string' &&
        normalizeCandidateAssetPath(data.url) === normalizedUploadUrl
    );

  const hasApprovedPhotoNode = matchingPhotoData.some(
    (data) =>
      data.status !== 'PENDING' &&
      data.status !== 'REJECTED' &&
      data.isVisible !== false
  );
  const hasPendingOrUnapprovedPhotoNode = matchingPhotoData.some(
    (data) =>
      data.status === 'PENDING' ||
      data.status === 'REJECTED' ||
      data.isVisible === false
  );

  if (isAdmin) {
    return {
      allowed: true,
      cacheControl:
        hasPendingOrUnapprovedPhotoNode && !hasApprovedPhotoNode
          ? 'private, no-store'
          : 'private, no-cache',
    };
  }

  // Non-admin callers must never receive PENDING, REJECTED, or hidden Photo assets
  if (hasPendingOrUnapprovedPhotoNode && !hasApprovedPhotoNode) {
    return { allowed: false, cacheControl: 'private, no-store' };
  }

  // /uploads/photos/* requires an approved, visible Photo ContentNode (rejects orphaned files)
  if (isPhotoUploadPath) {
    return {
      allowed: hasApprovedPhotoNode,
      cacheControl: 'private, no-cache',
    };
  }

  const hasMatchingMediaRow = mediaRows.some(
    (row) => normalizeCandidateAssetPath(row.url) === normalizedUploadUrl
  );

  const allowed =
    isPublicBrandingAsset ||
    isConfiguredSiteAsset ||
    hasApprovedPhotoNode ||
    hasMatchingMediaRow;

  return {
    allowed,
    cacheControl: 'private, no-cache',
  };
}

async function handleUploadRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } },
  headOnly: boolean
): Promise<NextResponse> {
  const rateLimitResponse = await rateLimit(request, 100, 60 * 1000);
  if (rateLimitResponse) {
    return createErrorResponse(429, 'Too many requests, please try again later.', headOnly);
  }

  try {
    validateRawRequestPathname(request.url);
    const resolvedParams = await Promise.resolve(context.params);
    const storageKey = buildUploadKey(resolvedParams?.path);
    const normalizedUploadUrl = `/${storageKey}`;
    const isPhotoUploadPath =
      storageKey === 'uploads/photos' || storageKey.startsWith('uploads/photos/');

    const isAdmin = await isAdminRequest(request);
    const isPasscodeGuest = !isAdmin && (await isGuestRequest(request));
    const activeInviteSession =
      !isAdmin && !isPasscodeGuest ? await getGuestInviteSession(request) : null;
    const activePhotoSession =
      !isAdmin && !isPasscodeGuest && !activeInviteSession && isPhotoUploadPath
        ? await getActivePhotoUploadSession(request)
        : null;
    const hasAuthorizedSession = Boolean(
      isAdmin || isPasscodeGuest || activeInviteSession || activePhotoSession
    );

    let isPublicBrandingAsset = false;
    let isConfiguredSiteAsset = false;

    if (!isAdmin && !isPhotoUploadPath) {
      const appConfig = await getAppConfig();
      const publicBrandingPaths = [appConfig.ogImageUrl, appConfig.faviconUrl]
        .map((candidate) => normalizeCandidateAssetPath(candidate))
        .filter((candidate): candidate is string => candidate !== null);
      isPublicBrandingAsset = publicBrandingPaths.includes(normalizedUploadUrl);

      if (hasAuthorizedSession) {
        const siteAssetPaths = [
          appConfig.brandLogoUrl,
          appConfig.heroImageUrl,
          appConfig.brandWatermarkUrl,
          appConfig.badgeGraphicUrl,
        ]
          .map((candidate) => normalizeCandidateAssetPath(candidate))
          .filter((candidate): candidate is string => candidate !== null);
        isConfiguredSiteAsset = siteAssetPaths.includes(normalizedUploadUrl);
      }
    }

    if (!hasAuthorizedSession && (isPhotoUploadPath || !isPublicBrandingAsset)) {
      return createErrorResponse(401, 'Unauthorized', headOnly);
    }

    const access = await resolveUploadAccessAndCachePolicy({
      storageKey,
      normalizedUploadUrl,
      isPhotoUploadPath,
      isAdmin,
      isPublicBrandingAsset,
      isConfiguredSiteAsset,
    });

    if (!access.allowed) {
      return createErrorResponse(404, 'Not Found', headOnly);
    }

    const provider = getStorageProvider();
    const asset: LocalUploadStreamResult | null = await provider.openReadStream(storageKey, {
      headOnly,
    });

    if (!asset) {
      return createErrorResponse(404, 'Not Found', headOnly);
    }

    const headers: Record<string, string> = {
      ...BASE_SECURITY_HEADERS,
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.size),
      'Last-Modified': asset.updatedAt.toUTCString(),
      'Cache-Control': access.cacheControl,
      Vary: 'Cookie',
    };

    if (headOnly || !asset.stream) {
      return new NextResponse(null, { status: 200, headers });
    }

    return new NextResponse(asset.stream, { status: 200, headers });
  } catch (error: unknown) {
    if (error instanceof PathContainmentError) {
      return createErrorResponse(400, 'Invalid upload path', headOnly);
    }
    return createErrorResponse(500, 'Internal Server Error', headOnly);
  }
}

/**
 * Streams authorized local or S3-backed uploaded files dynamically at /uploads/*.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } }
): Promise<NextResponse> {
  return handleUploadRequest(request, context, false);
}

/**
 * Returns upload metadata headers without body payload for authorized /uploads/* requests.
 */
export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } }
): Promise<NextResponse> {
  return handleUploadRequest(request, context, true);
}
