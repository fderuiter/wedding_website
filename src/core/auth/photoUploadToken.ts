import { NextRequest } from 'next/server';
import { getGuestSessionSecret } from './guestInviteToken';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_PHOTO_COOKIE = 'guest_photo_session';
export const PHOTO_QR_QUERY_PARAM = 'qr';
export const PHOTO_QR_LINK_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days for printed reception cards
export const GUEST_PHOTO_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60; // 7 days

export interface PhotoQrLinkPayload {
  purpose: 'photo_qr_link';
  v: number;
  iat: number;
  exp: number;
}

export interface PhotoUploadSessionPayload {
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
  iat?: number;
  exp?: number;
}): Promise<string> {
  const iat = options?.iat ?? Date.now();
  const exp = options?.exp ?? iat + PHOTO_QR_LINK_TTL_MS;
  const payload: PhotoQrLinkPayload = {
    purpose: 'photo_qr_link',
    v: normalizeTokenVersion(options?.v),
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
  iat?: number;
  exp?: number;
}): Promise<string> {
  const iat = options?.iat ?? Date.now();
  const exp = options?.exp ?? iat + GUEST_PHOTO_SESSION_MAX_AGE_SECONDS * 1000;
  const payload: PhotoUploadSessionPayload = {
    purpose: 'photo_upload_session',
    v: normalizeTokenVersion(options?.v),
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
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the HMAC signature and expiration of the guest_photo_session cookie (Edge-compatible).
 */
export async function getSignedPhotoUploadSession(
  req?: NextRequest
): Promise<PhotoUploadSessionPayload | null> {
  const cookieValue = await readRequestCookie(GUEST_PHOTO_COOKIE, req, { suppressErrors: true });
  if (!cookieValue) {
    return null;
  }
  return verifyPhotoUploadSessionToken(cookieValue);
}

/**
 * Builds a signed deep-linked photo upload URL for QR codes on slideshows and printed cards.
 */
export async function buildSignedPhotoUploadUrl(
  baseUrl: string | null | undefined,
  tokenVersion?: number
): Promise<{ token: string; uploadUrl: string }> {
  const token = await signPhotoQrLinkToken({ v: tokenVersion });
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
  if (normalizedPath === '/api/photos' && upperMethod === 'GET') {
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
  return isPhotoScopedPagePath(normalizedPath) || isPhotoScopedApiRoute(normalizedPath, method);
}
