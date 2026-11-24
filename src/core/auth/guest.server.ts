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

export const GUEST_COOKIE = 'guest_auth';

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
  const cookieValue = await readRequestCookie(GUEST_COOKIE, req, { suppressErrors: true });
  if (!cookieValue) return false;

  const payload = await verifyGuestToken(cookieValue);
  if (!payload || payload.guest !== true) {
    return false;
  }

  if (process.env.NEXT_RUNTIME !== 'edge' && !options?.edgeOnly) {
    const { verifyNodeTenantClaims } = await import('./tenantClaims.node');
    return verifyNodeTenantClaims(payload, req);
  }

  const requestSubdomain = await resolveEdgeRequestSubdomain(req);
  return verifyEdgeTenantClaims(payload, requestSubdomain);
}
