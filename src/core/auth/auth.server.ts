import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { deriveAdminSigningKey } from '@/utils/crypto';
import {
  readRequestCookie,
  signCompactToken,
  verifyCompactToken,
} from './tokenCookieHelpers';

export const ADMIN_COOKIE = 'admin_auth';

/**
 * Return default cookie options for admin authentication.
 *
 * @param maxAge - Optional cookie expiration in seconds (defaults to 8 hours: 28800 seconds).
 * @returns Standard cookie options object.
 */
export function getAdminCookieOptions(maxAge: number = 60 * 60 * 8) {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

/**
 * Sets the admin authentication cookie on a response object.
 *
 * @param response - The NextResponse instance to set the cookie on.
 * @param token - The token string to store.
 * @param maxAge - Optional maxAge override in seconds.
 * @returns The response instance.
 */
export function setAdminAuthCookie(response: NextResponse, token: string, maxAge?: number): NextResponse {
  response.cookies.set(ADMIN_COOKIE, token, getAdminCookieOptions(maxAge));
  return response;
}

/**
 * Resolve the admin signing secret used for token HMAC operations.
 *
 * @returns The secret string used to sign and verify admin tokens
 */
async function getSecret(): Promise<string> {
  return deriveAdminSigningKey(env.ADMIN_PASSWORD);
}

export interface AdminTokenPayload {
  isAdmin: boolean;
  adminSessionVersion?: number;
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

/**
 * Signs an admin payload and returns a compact token.
 *
 * @param payload - The admin token payload to sign.
 * @returns A signed token string in the format `base64url(payload).base64url(signature)`.
 */
export async function signAdminToken(payload: AdminTokenPayload): Promise<string> {
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Admin auth secret is not configured');
  }
  return signCompactToken(payload, secret);
}

/**
 * Validate a base64url-signed admin token and return its decoded payload.
 *
 * @param token - Signed token in the form `base64url(payload).base64url(hmac)` 
 * @returns The parsed `AdminTokenPayload` if the token is valid, matches HMAC signature, and is not expired; `null` otherwise.
 */
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;

  try {
    const secret = await getSecret();
    if (!secret) return null;

    const payload = await verifyCompactToken<AdminTokenPayload>(token, secret);
    if (!payload) {
      return null;
    }

    // Enforce expiration
    const now = Date.now();
    if (payload.exp && payload.exp < now) {
      return null;
    }

    // Fallback for older tokens without 'exp', expire after 8 hours from 'iat'
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

export async function getVerifiedAdminPayload(req?: NextRequest): Promise<AdminTokenPayload | null> {
  const cookieValue = await readRequestCookie(ADMIN_COOKIE, req, { suppressErrors: true });
  if (!cookieValue) return null;

  const payload = await verifyAdminToken(cookieValue);
  if (!payload || payload.isAdmin !== true) {
    return null;
  }

  return payload;
}

/**
 * Determine whether the current request/session represents an authenticated admin.
 *
 * @param req - Optional Next.js request object; provide this in API route contexts. Omit when running in Server Components.
 * @param expectedSessionVersion - Optional session version from AppConfig to enforce immediate revocation on rotation.
 * @returns `true` if the request/session represents an authenticated admin, `false` otherwise.
 */
export async function isAdminRequest(req?: NextRequest, expectedSessionVersion?: number): Promise<boolean> {
  const cookieValue = await readRequestCookie(ADMIN_COOKIE, req);
  if (!cookieValue) return false;

  const payload = await verifyAdminToken(cookieValue);

  if (!payload || payload.isAdmin !== true) {
    return false;
  }

  if (typeof expectedSessionVersion === 'number') {
    const tokenVersion = typeof payload.adminSessionVersion === 'number' ? payload.adminSessionVersion : 1;
    if (tokenVersion !== expectedSessionVersion) {
      return false;
    }
  }

  return true;
}
