import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { deriveAdminSigningKey } from '@/utils/crypto';
import { normalizeTenantSubdomain } from '@/utils/hostValidation';
import {
  resolveEdgeRequestSubdomain,
  verifyEdgeTenantClaims,
} from './tenantClaims';
import {
  isValidTokenEpochVersion,
  normalizeTokenEpochVersion,
} from './tokenEpochs';
import {
  clearSessionCookie,
  findVerifiedRequestCookie,
  getSessionCookieOptions,
  resolveSessionCookieName,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const ADMIN_COOKIE = 'admin_auth';

/**
 * Return default cookie options for admin authentication.
 *
 * @param maxAge - Optional cookie expiration in seconds (defaults to 8 hours: 28800 seconds).
 * @param req - Optional request used to determine HTTPS production `__Host-` context.
 * @returns Standard cookie options object.
 */
export function getAdminCookieOptions(
  maxAge: number = 60 * 60 * 8,
  req?: NextRequest | Request
) {
  return getSessionCookieOptions(maxAge, req);
}

/**
 * Sets the admin authentication cookie on a response object (`__Host-admin_auth` over HTTPS in production).
 *
 * @param response - The NextResponse instance to set the cookie on.
 * @param token - The token string to store.
 * @param maxAge - Optional maxAge override in seconds.
 * @param req - Optional request used to determine HTTPS production `__Host-` context.
 * @returns The response instance.
 */
export function setAdminAuthCookie(
  response: NextResponse,
  token: string,
  maxAge?: number,
  req?: NextRequest | Request
): NextResponse {
  if (maxAge === 0) {
    return clearSessionCookie(response, ADMIN_COOKIE, req);
  }
  const cookieName = resolveSessionCookieName(ADMIN_COOKIE, req);
  response.cookies.set(cookieName, token, getAdminCookieOptions(maxAge, req));
  return response;
}

async function getSecret(): Promise<string> {
  return deriveAdminSigningKey(env.ADMIN_PASSWORD);
}

interface AdminTokenPayload {
  isAdmin: boolean;
  v?: number;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/**
 * Signs an admin payload and returns a compact token.
 */
export async function signAdminToken(payload: AdminTokenPayload): Promise<string> {
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Admin auth secret is not configured');
  }

  const normalizedPayload: AdminTokenPayload = {
    ...payload,
    v: normalizeTokenEpochVersion(payload.v),
    ...('subdomain' in payload && payload.subdomain !== undefined
      ? { subdomain: normalizeTenantSubdomain(payload.subdomain) }
      : {}),
  };

  return signCompactToken(normalizedPayload, secret);
}

/**
 * Validate a base64url-signed admin token and return its decoded payload.
 */
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = await getSecret();
    if (!secret) return null;

    const payload = await verifyCompactToken<AdminTokenPayload>(token, secret);
    if (!payload || !isValidTokenEpochVersion(payload.v)) {
      return null;
    }

    const now = Date.now();
    if (payload.exp && payload.exp < now) {
      return null;
    }

    if (!payload.exp && payload.iat) {
      const defaultExp = payload.iat + 60 * 60 * 8 * 1000;
      if (defaultExp < now) {
        return null;
      }
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Determine whether the current request/session represents an authenticated admin.
 * In Edge middleware (`NEXT_RUNTIME === 'edge'` or `edgeOnly: true`), verifies the
 * stateless `subdomain` claim without database access; in Node API/SSR contexts,
 * verifies both `siteId` and `subdomain` against `AppConfig` when `MULTISITE_ENABLED` is active.
 */
export async function isAdminRequest(
  req?: NextRequest,
  options?: { edgeOnly?: boolean }
): Promise<boolean> {
  const verified = await findVerifiedRequestCookie(
    ADMIN_COOKIE,
    req,
    async (token) => {
      const payload = await verifyAdminToken(token);
      if (!payload || payload.isAdmin !== true) {
        return null;
      }

      if (process.env.NEXT_RUNTIME !== 'edge' && !options?.edgeOnly) {
        const [{ verifyNodeTenantClaims }, { resolveActiveAdminTokenVersion }] =
          await Promise.all([
            import('./tenantClaims.node'),
            import('./adminTokenVersion.node'),
          ]);
        if (!(await verifyNodeTenantClaims(payload, req))) {
          return null;
        }
        const activeVersion = await resolveActiveAdminTokenVersion(payload.siteId);
        return activeVersion !== null && payload.v === activeVersion ? payload : null;
      }

      const requestSubdomain = await resolveEdgeRequestSubdomain(req);
      return verifyEdgeTenantClaims(payload, requestSubdomain) ? payload : null;
    },
    { suppressErrors: true }
  );

  return Boolean(verified);
}
