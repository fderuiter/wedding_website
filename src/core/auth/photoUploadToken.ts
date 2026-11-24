import { NextRequest } from 'next/server';
import { normalizeTenantSubdomain } from '@/utils/hostValidation';
import { getGuestSessionSecret } from './guestInviteToken';
import {
  resolveEdgeRequestSubdomain,
  type TenantTokenClaims,
  verifyEdgeTenantClaims,
} from './tenantClaims';
import {
  readRequestCookieCandidates,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_PHOTO_COOKIE = 'guest_photo_session';
export const PHOTO_QR_QUERY_PARAM = 'qr';
export const PHOTO_QR_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days for printed reception cards
export const GUEST_PHOTO_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface PhotoQrLinkPayload extends TenantTokenClaims {
  purpose: 'photo_qr_link';
  v: number;
  iat: number;
  exp: number;
}

export interface PhotoUploadSessionPayload extends TenantTokenClaims {
  purpose: 'photo_upload_session';
  v: number;
  iat: number;
  exp: number;
}

function normalizeTokenVersion(version?: number): number {
  if (typeof version === 'number' && Number.isInteger(version) && version >= 1) {
    return version;
  }
  return 1;
}

/**
 * Signs a shareable/printable QR link token scoped strictly to photo gallery access & uploads.
 */
export async function signPhotoQrLinkToken(options?: {
  v?: number;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
}): Promise<string> {
  const iat = options?.iat ?? Date.now();
  const exp = options?.exp ?? iat + PHOTO_QR_LINK_TTL_MS;
  const payload: PhotoQrLinkPayload = {
    purpose: 'photo_qr_link',
    v: normalizeTokenVersion(options?.v),
    ...(options?.siteId !== undefined ? { siteId: options.siteId } : {}),
    ...(options && 'subdomain' in options && options.subdomain !== undefined
      ? { subdomain: normalizeTenantSubdomain(options.subdomain) }
      : {}),
    iat,
    exp,
  };
  const secret = await getGuestSessionSecret();
  return signCompactToken(payload, secret);
}

/**
 * Verifies a signed QR link token's HMAC signature, purpose claim, and expiration (Edge-compatible).
 */
export async function verifyPhotoQrLinkToken(
  token: string | null | undefined
): Promise<PhotoQrLinkPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const secret = await getGuestSessionSecret();
    const payload = await verifyCompactToken<Partial<PhotoQrLinkPayload>>(token, secret);
    if (
      !payload ||
      payload.purpose !== 'photo_qr_link' ||
      typeof payload.v !== 'number' ||
      !Number.isInteger(payload.v) ||
      payload.v < 1 ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    if (payload.exp < Date.now()) {
      return null;
    }

    return {
      purpose: 'photo_qr_link',
      v: payload.v,
      ...(typeof payload.siteId === 'string' ? { siteId: payload.siteId } : {}),
      ...('subdomain' in payload &&
      (payload.subdomain === null || typeof payload.subdomain === 'string')
        ? { subdomain: normalizeTenantSubdomain(payload.subdomain) }
        : {}),
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Signs an HttpOnly photo-scoped session cookie token carrying the QR rotation version.
 */
export async function signPhotoUploadSessionToken(options?: {
  v?: number;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
}): Promise<string> {
  const iat = options?.iat ?? Date.now();
  const exp = options?.exp ?? iat + GUEST_PHOTO_SESSION_MAX_AGE_SECONDS * 1000;
  const payload: PhotoUploadSessionPayload = {
    purpose: 'photo_upload_session',
    v: normalizeTokenVersion(options?.v),
    ...(options?.siteId !== undefined ? { siteId: options.siteId } : {}),
    ...(options && 'subdomain' in options && options.subdomain !== undefined
      ? { subdomain: normalizeTenantSubdomain(options.subdomain) }
      : {}),
    iat,
    exp,
  };
  const secret = await getGuestSessionSecret();
  return signCompactToken(payload, secret);
}

/**
 * Verifies the HMAC signature, purpose claim, and expiration of a photo-scoped session token.
 */
export async function verifyPhotoUploadSessionToken(
  token: string | null | undefined
): Promise<PhotoUploadSessionPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const secret = await getGuestSessionSecret();
    const payload = await verifyCompactToken<Partial<PhotoUploadSessionPayload>>(token, secret);
    if (
      !payload ||
      payload.purpose !== 'photo_upload_session' ||
      typeof payload.v !== 'number' ||
      !Number.isInteger(payload.v) ||
      payload.v < 1 ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    if (payload.exp < Date.now()) {
      return null;
    }

    return {
      purpose: 'photo_upload_session',
      v: payload.v,
      ...(typeof payload.siteId === 'string' ? { siteId: payload.siteId } : {}),
      ...('subdomain' in payload &&
      (payload.subdomain === null || typeof payload.subdomain === 'string')
        ? { subdomain: normalizeTenantSubdomain(payload.subdomain) }
        : {}),
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

const requestSignedPhotoSessionCache = new WeakMap<
  object,
  Map<string, Promise<PhotoUploadSessionPayload | null>>
>();

async function verifyCachedPhotoCookieCandidate(
  cookieValue: string,
  req?: NextRequest
): Promise<PhotoUploadSessionPayload | null> {
  if (req && typeof req === 'object') {
    let byCookie = requestSignedPhotoSessionCache.get(req);
    let cached = byCookie?.get(cookieValue);
    if (!cached) {
      cached = verifyPhotoUploadSessionToken(cookieValue).catch((err) => {
        byCookie?.delete(cookieValue);
        throw err;
      });
      if (!byCookie) {
        byCookie = new Map();
        requestSignedPhotoSessionCache.set(req, byCookie);
      }
      byCookie.set(cookieValue, cached);
    }

    try {
      const payload = await cached;
      return payload && payload.exp >= Date.now() ? payload : null;
    } catch {
      return null;
    }
  }

  return verifyPhotoUploadSessionToken(cookieValue);
}

/**
 * Reads and verifies the HMAC signature and expiration of the `guest_photo_session`
 * cookie with per-request WeakMap deduplication, prior to tenant claim filtering.
 */
export async function getRawSignedPhotoUploadSession(
  req?: NextRequest
): Promise<PhotoUploadSessionPayload | null> {
  const candidates = await readRequestCookieCandidates(GUEST_PHOTO_COOKIE, req, {
    suppressErrors: true,
  });
  if (candidates.length === 0) {
    return null;
  }

  for (const cookieValue of candidates) {
    const payload = await verifyCachedPhotoCookieCandidate(cookieValue, req);
    if (payload) {
      return payload;
    }
  }

  return null;
}

/**
 * Reads and verifies the HMAC signature, expiration, and Edge tenant claims of the
 * `guest_photo_session` cookie (Edge-compatible), evaluating every matching candidate.
 */
export async function getSignedPhotoUploadSession(
  req?: NextRequest
): Promise<PhotoUploadSessionPayload | null> {
  const candidates = await readRequestCookieCandidates(GUEST_PHOTO_COOKIE, req, {
    suppressErrors: true,
  });
  if (candidates.length === 0) {
    return null;
  }

  let resolvedSubdomain: string | null | undefined;
  for (const cookieValue of candidates) {
    const payload = await verifyCachedPhotoCookieCandidate(cookieValue, req);
    if (!payload) {
      continue;
    }

    if (resolvedSubdomain === undefined) {
      resolvedSubdomain = await resolveEdgeRequestSubdomain(req);
    }
    if (!verifyEdgeTenantClaims(payload, resolvedSubdomain)) {
      continue;
    }

    return payload;
  }

  return null;
}

/**
 * Builds a signed deep-linked photo upload URL for QR codes on slideshows and printed cards.
 */
export async function buildSignedPhotoUploadUrl(
  baseUrl: string | null | undefined,
  tokenVersion?: number,
  tenantClaims?: TenantTokenClaims
): Promise<{ token: string; uploadUrl: string }> {
  const token = await signPhotoQrLinkToken({
    v: tokenVersion,
    ...(tenantClaims?.siteId !== undefined ? { siteId: tenantClaims.siteId } : {}),
    ...(tenantClaims && 'subdomain' in tenantClaims && tenantClaims.subdomain !== undefined
      ? { subdomain: tenantClaims.subdomain }
      : {}),
  });
  const cleanBaseUrl = (baseUrl ?? '').trim().replace(/\/+$/, '');
  const uploadUrl = `${cleanBaseUrl}/photos?${PHOTO_QR_QUERY_PARAM}=${encodeURIComponent(token)}`;
  return { token, uploadUrl };
}

/**
 * Checks whether a normalized UI page pathname is accessible to photo-scoped sessions.
 */
export function isPhotoScopedPagePath(normalizedPath: string): boolean {
  return normalizedPath === '/photos' || normalizedPath === '/photos/slideshow';
}

/**
 * Checks whether a normalized API pathname + HTTP method is accessible to photo-scoped sessions.
 */
export function isPhotoScopedApiRoute(normalizedPath: string, method?: string): boolean {
  const upperMethod = (method || 'GET').toUpperCase();
  if (normalizedPath === '/api/photos' && (upperMethod === 'GET' || upperMethod === 'HEAD')) {
    return true;
  }
  if (
    (normalizedPath === '/api/uploads/photos' ||
      normalizedPath.startsWith('/api/uploads/photos/')) &&
    (upperMethod === 'GET' || upperMethod === 'HEAD')
  ) {
    return true;
  }
  if (
    (normalizedPath === '/api/guest/photos/upload' || normalizedPath === '/api/photos/upload') &&
    upperMethod === 'POST'
  ) {
    return true;
  }
  return false;
}

/**
 * Checks whether a normalized path + HTTP method is accessible to photo-scoped sessions.
 */
export function isPhotoScopedRoute(normalizedPath: string, method?: string): boolean {
  const upperMethod = (method || 'GET').toUpperCase();
  const isPhotoUploadAssetRead =
    (normalizedPath === '/uploads/photos' || normalizedPath.startsWith('/uploads/photos/')) &&
    (upperMethod === 'GET' || upperMethod === 'HEAD');
  return (
    isPhotoScopedPagePath(normalizedPath) ||
    isPhotoScopedApiRoute(normalizedPath, method) ||
    isPhotoUploadAssetRead
  );
}
