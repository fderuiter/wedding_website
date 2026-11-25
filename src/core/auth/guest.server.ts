import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import {
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';
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
const GUEST_PASSCODE_DIGEST_DOMAIN = 'wedding-website:guest-passcode-digest:v1';

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
  pwd?: string;
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

function resolveActiveGuestPasscode(): string {
  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  const rawPasscode = isProduction
    ? (process.env.GUEST_PASSCODE || 'wedding2026')
    : (env.GUEST_PASSCODE || process.env.GUEST_PASSCODE || 'wedding2026');
  return rawPasscode.trim() || 'wedding2026';
}

async function computeGuestPasscodeDigest(secret: string, passcode: string): Promise<string> {
  return hmacSha256(`${GUEST_PASSCODE_DIGEST_DOMAIN}:${secret}`, passcode);
}

export async function signGuestToken(payload: GuestTokenPayload): Promise<string> {
  const secret = resolveGuestSigningSecret();
  if (!secret) {
    throw new Error('Guest auth secret is not configured');
  }
  const passcodeDigest = await computeGuestPasscodeDigest(
    secret,
    resolveActiveGuestPasscode()
  );
  const normalizedPayload: GuestTokenPayload = {
    ...payload,
    jti: payload.jti ?? createPerLoginTokenId(),
    pwd: passcodeDigest,
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

    if (typeof payload.pwd !== 'string' || payload.pwd.length === 0) {
      return null;
    }

    const expectedDigest = await computeGuestPasscodeDigest(
      secret,
      resolveActiveGuestPasscode()
    );
    const actualBytes = base64urlDecodeToBytes(payload.pwd);
    const expectedBytes = base64urlDecodeToBytes(expectedDigest);
    if (!timingSafeEqualJS(actualBytes, expectedBytes)) {
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
