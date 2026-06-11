import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { getAppConfig } from '@/lib/config';

const ADMIN_COOKIE = 'admin_auth';

/**
 * Resolve the admin signing secret used for token HMAC operations.
 *
 * Prefers the `ADMIN_PASSWORD` environment variable; if absent, loads the application
 * configuration and returns `config.adminPassword`; if that is also missing, returns `null`.
 *
 * @returns The secret string used to sign and verify admin tokens, or null if unavailable
 */
let cachedConfigSecret: Promise<string | null> | null = null;

async function getSecret(): Promise<string | null> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;

  if (!cachedConfigSecret) {
    cachedConfigSecret = getAppConfig().then((config) => config.adminPassword ?? null);
  }

  return cachedConfigSecret;
}

interface AdminTokenPayload {
  isAdmin: boolean;
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
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Admin auth secret is not configured');
  }
  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');
  return `${data}.${signature}`;
}

/**
 * Validate a base64url-signed admin token and return its decoded payload.
 *
 * @param token - Signed token in the form `base64url(payload).base64url(hmac)` 
 * @returns The parsed `AdminTokenPayload` if the token is valid and the signature matches, `null` otherwise.
 */
export async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const secret = await getSecret();
  if (!secret) return null;
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature, 'base64url');
  const expectedSignatureBuffer = Buffer.from(expectedSignature, 'base64url');

  // Prevent timing attacks using timingSafeEqual
  if (signatureBuffer.length !== expectedSignatureBuffer.length) {
    return null;
  }

  if (!crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  try {
    return JSON.parse(Buffer.from(data, 'base64url').toString('utf-8')) as AdminTokenPayload;
  } catch {
    return null;
  }
}

/**
 * Determine whether the current request/session represents an authenticated admin.
 *
 * @param req - Optional Next.js request object; provide this in API route contexts. Omit when running in Server Components.
 * @returns `true` if the request/session represents an authenticated admin, `false` otherwise.
 */
export async function isAdminRequest(req?: NextRequest): Promise<boolean> {
  let cookieValue: string | undefined;

  if (req) {
    // API Route (Edge or Node)
    cookieValue = req.cookies?.get?.(ADMIN_COOKIE)?.value ||
                  req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${ADMIN_COOKIE}=`))?.split('=')[1];
  } else {
    // Server Component (App Router)
    const cookieStore = await cookies();
    cookieValue = cookieStore.get(ADMIN_COOKIE)?.value;
  }

  if (!cookieValue) return false;

  const payload = await verifyAdminToken(cookieValue);

  if (!payload || payload.isAdmin !== true) {
    return false;
  }

  // Enforce expiration
  const now = Date.now();
  if (payload.exp && payload.exp < now) {
    return false;
  }

  // Fallback for older tokens without 'exp', expire after 8 hours from 'iat'
  if (!payload.exp && payload.iat) {
    const defaultExp = payload.iat + 60 * 60 * 8 * 1000;
    if (defaultExp < now) {
      return false;
    }
  }

  return true;
}
