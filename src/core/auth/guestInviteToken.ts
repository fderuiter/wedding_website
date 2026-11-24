import { NextRequest } from 'next/server';
import { normalizeTenantSubdomain } from '@/utils/hostValidation';
import { resolveGuestSigningSecret } from './guestHeaderSignature';
import {
  resolveEdgeRequestSubdomain,
  verifyEdgeTenantClaims,
} from './tenantClaims';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_INVITE_COOKIE = 'guest_invite_session';

export interface GuestInviteSessionPayload {
  code: string;
  guestName: string;
  email?: string | null;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
}

export async function getGuestSessionSecret(): Promise<string> {
  return resolveGuestSigningSecret();
}

/**
 * Signs a guest invitation payload into a JWT-like compact token with 7-day expiration.
 */
export async function signGuestInviteSessionToken(
  payload: Omit<GuestInviteSessionPayload, 'iat' | 'exp'> & { iat?: number; exp?: number }
): Promise<string> {
  const iat = payload.iat ?? Date.now();
  const exp = payload.exp ?? (iat + 7 * 24 * 60 * 60 * 1000); // 7 days
  const fullPayload: GuestInviteSessionPayload = {
    code: payload.code,
    guestName: payload.guestName,
    ...(payload.siteId !== undefined ? { siteId: payload.siteId } : {}),
    ...('subdomain' in payload && payload.subdomain !== undefined
      ? { subdomain: normalizeTenantSubdomain(payload.subdomain) }
      : {}),
    iat,
    exp,
  };
  const secret = await getGuestSessionSecret();
  return signCompactToken(fullPayload, secret);
}

/**
 * Validates a guest invitation session token signature and expiry without database access.
 */
export async function verifyGuestInviteSessionToken(
  token: string
): Promise<GuestInviteSessionPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = await getGuestSessionSecret();
    const payload = await verifyCompactToken<GuestInviteSessionPayload>(token, secret);
    if (!payload || !payload.code || !payload.guestName) {
      return null;
    }

    const now = Date.now();
    if (payload.exp && payload.exp < now) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

const requestSignedSessionCache = new WeakMap<
  object,
  Map<string, Promise<GuestInviteSessionPayload | null>>
>();

/**
 * Reads and verifies the HMAC signature and expiration of the `guest_invite_session`
 * cookie with per-request WeakMap deduplication, prior to tenant claim filtering.
 */
export async function getRawSignedGuestInviteSession(
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
  const cookieValue = await readRequestCookie(GUEST_INVITE_COOKIE, req, { suppressErrors: true });
  if (!cookieValue) return null;

  if (req && typeof req === 'object') {
    let byCookie = requestSignedSessionCache.get(req);
    let cached = byCookie?.get(cookieValue);
    if (!cached) {
      cached = verifyGuestInviteSessionToken(cookieValue).catch((err) => {
        byCookie?.delete(cookieValue);
        throw err;
      });
      if (!byCookie) {
        byCookie = new Map();
        requestSignedSessionCache.set(req, byCookie);
      }
      byCookie.set(cookieValue, cached);
    }

    const payload = await cached;
    if (!payload) return null;
    if (payload.exp && payload.exp < Date.now()) {
      return null;
    }
    return payload;
  }

  return verifyGuestInviteSessionToken(cookieValue);
}

/**
 * Reads and verifies the HMAC signature, expiration, and Edge tenant claims of the
 * `guest_invite_session` cookie without performing database lookups (Edge-compatible).
 */
export async function getSignedGuestInviteSession(
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
  const payload = await getRawSignedGuestInviteSession(req);
  if (!payload) return null;

  const requestSubdomain = await resolveEdgeRequestSubdomain(req);
  if (!verifyEdgeTenantClaims(payload, requestSubdomain)) {
    return null;
  }

  return payload;
}
