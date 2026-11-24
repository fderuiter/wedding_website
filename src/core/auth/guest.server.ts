import { NextRequest, NextResponse } from 'next/server';
import { normalizeTenantSubdomain } from '@/utils/hostValidation';
import { resolveGuestSigningSecret } from './guestHeaderSignature';
import {
  resolveEdgeRequestSubdomain,
  verifyEdgeTenantClaims,
} from './tenantClaims';
import {
  findVerifiedRequestCookie,
  getSessionCookieOptions,
  resolveSessionCookieName,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const GUEST_COOKIE = 'guest_auth';

export function setGuestAuthCookie(
  response: NextResponse,
  token: string,
  req?: NextRequest | Request,
  maxAge: number = 7 * 24 * 60 * 60
): NextResponse {
  const cookieName = resolveSessionCookieName(GUEST_COOKIE, req);
  response.cookies.set(cookieName, token, getSessionCookieOptions(maxAge, req));
  return response;
}
interface GuestTokenPayload {
  guest: boolean;
  jti?: string;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
}

function createPerLoginTokenId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function signGuestToken(payload: GuestTokenPayload): Promise<string> {
  const secret = resolveGuestSigningSecret();
  if (!secret) {
    throw new Error('Guest auth secret is not configured');
  }
  const normalizedPayload: GuestTokenPayload = {
    ...payload,
    jti: payload.jti ?? createPerLoginTokenId(),
    ...('subdomain' in payload && payload.subdomain !== undefined
      ? { subdomain: normalizeTenantSubdomain(payload.subdomain) }
      : {}),
  };
  return signCompactToken(normalizedPayload, secret);
}

export async function verifyGuestToken(token: string): Promise<GuestTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = resolveGuestSigningSecret();
    if (!secret) return null;
    const payload = await verifyCompactToken<GuestTokenPayload>(token, secret);
    if (!payload || payload.guest !== true) {
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

export async function isGuestRequest(
  req?: NextRequest,
  options?: { edgeOnly?: boolean }
): Promise<boolean> {
  const verified = await findVerifiedRequestCookie(
    GUEST_COOKIE,
    req,
    async (token) => {
      const payload = await verifyGuestToken(token);
      if (!payload || payload.guest !== true) {
        return null;
      }

      if (process.env.NEXT_RUNTIME !== 'edge' && !options?.edgeOnly) {
        const { verifyNodeTenantClaims } = await import('./tenantClaims.node');
        return (await verifyNodeTenantClaims(payload, req)) ? payload : null;
      }

      const requestSubdomain = await resolveEdgeRequestSubdomain(req);
      return verifyEdgeTenantClaims(payload, requestSubdomain) ? payload : null;
    },
    { suppressErrors: true }
  );

  return Boolean(verified);
}
