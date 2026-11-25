import { NextRequest, NextResponse } from 'next/server';
import { normalizeTenantSubdomain } from '@/utils/hostValidation';
import { resolveGuestSigningSecret } from './guestHeaderSignature';
import {
  resolveEdgeRequestSubdomain,
  verifyEdgeTenantClaims,
} from './tenantClaims';
import {
  clearSessionCookie,
  getSessionCookieOptions,
  readRequestCookieCandidates,
  resolveSessionCookieName,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_INVITE_COOKIE = 'guest_invite_session';

export function setGuestInviteSessionCookie(
  response: NextResponse,
  token: string,
  req?: NextRequest | Request,
  maxAge: number = 7 * 24 * 60 * 60
): NextResponse {
  const cookieName = resolveSessionCookieName(GUEST_INVITE_COOKIE, req);
  response.cookies.set(cookieName, token, getSessionCookieOptions(maxAge, req));
  return response;
}

export function clearGuestInviteSessionCookie(
  response: NextResponse,
  req?: NextRequest | Request
): NextResponse {
  return clearSessionCookie(response, GUEST_INVITE_COOKIE, req);
}

export interface GuestInvitePostalFields {
  householdName?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  country?: string | null;
}

export interface GuestInviteSessionPayload extends GuestInvitePostalFields {
  code: string;
  guestName: string;
  email?: string | null;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
}

export function extractOptionalInvitePostalFields(
  source: object | null | undefined
): Partial<Record<keyof GuestInvitePostalFields, string>> {
  if (!source || typeof source !== 'object') {
    return {};
  }
  const record = source as Partial<Record<keyof GuestInvitePostalFields, unknown>>;
  const fields: Array<keyof GuestInvitePostalFields> = [
    'householdName',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'zipCode',
    'country',
  ];
  const extracted: Partial<Record<keyof GuestInvitePostalFields, string>> = {};
  for (const key of fields) {
    const raw = record[key];
    if (typeof raw === 'string' && raw.trim().length > 0) {
      extracted[key] = raw.trim();
    }
  }
  return extracted;
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

async function verifyCachedInviteCookieCandidate(
  cookieValue: string,
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
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

    try {
      const payload = await cached;
      return payload && (!payload.exp || payload.exp >= Date.now()) ? payload : null;
    } catch {
      return null;
    }
  }

  return verifyGuestInviteSessionToken(cookieValue);
}

/**
 * Reads and verifies the HMAC signature and expiration of the `guest_invite_session`
 * cookie with per-request WeakMap deduplication, prior to tenant claim filtering.
 * Prefers `__Host-` cookies and checks every matching `Cookie` entry.
 */
export async function getRawSignedGuestInviteSessionWithToken(
  req?: NextRequest
): Promise<{ token: string; payload: GuestInviteSessionPayload } | null> {
  const candidates = await readRequestCookieCandidates(GUEST_INVITE_COOKIE, req, {
    suppressErrors: true,
  });
  if (candidates.length === 0) return null;

  for (const cookieValue of candidates) {
    const payload = await verifyCachedInviteCookieCandidate(cookieValue, req);
    if (payload) {
      return { token: cookieValue, payload };
    }
  }

  return null;
}

/**
 * Reads and verifies the HMAC signature and expiration of the `guest_invite_session`
 * cookie prior to tenant claim filtering.
 */
export async function getRawSignedGuestInviteSession(
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
  const verified = await getRawSignedGuestInviteSessionWithToken(req);
  return verified ? verified.payload : null;
}

/**
 * Reads and verifies the HMAC signature, expiration, and Edge tenant claims of the
 * `guest_invite_session` cookie, returning both the matched cookie token string and its
 * verified payload while caching per `NextRequest` instance. Prefers `__Host-` cookies
 * and checks every matching `Cookie` entry.
 */
export async function getSignedGuestInviteSessionWithToken(
  req?: NextRequest
): Promise<{ token: string; payload: GuestInviteSessionPayload } | null> {
  const candidates = await readRequestCookieCandidates(GUEST_INVITE_COOKIE, req, {
    suppressErrors: true,
  });
  if (candidates.length === 0) return null;

  let resolvedSubdomain: string | null | undefined;
  for (const cookieValue of candidates) {
    const payload = await verifyCachedInviteCookieCandidate(cookieValue, req);
    if (!payload) {
      continue;
    }

    if (resolvedSubdomain === undefined) {
      resolvedSubdomain = await resolveEdgeRequestSubdomain(req);
    }
    if (!verifyEdgeTenantClaims(payload, resolvedSubdomain)) {
      continue;
    }

    return { token: cookieValue, payload };
  }

  return null;
}

/**
 * Reads and verifies the HMAC signature, expiration, and Edge tenant claims of the
 * `guest_invite_session` cookie without performing database lookups (Edge-compatible).
 * Prefers `__Host-` cookies and checks every matching `Cookie` entry until verification succeeds.
 */
export async function getSignedGuestInviteSession(
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
  const verified = await getSignedGuestInviteSessionWithToken(req);
  return verified ? verified.payload : null;
}
