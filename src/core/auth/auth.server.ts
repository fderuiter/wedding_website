import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  base64urlEncode,
  base64urlDecode,
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';

const ADMIN_COOKIE = 'admin_auth';

/**
 * Resolve the admin signing secret used for token HMAC operations.
 *
 * @returns The secret string used to sign and verify admin tokens
 */
async function getSecret(): Promise<string> {
  return env.ADMIN_PASSWORD;
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
  const data = base64urlEncode(JSON.stringify(payload));
  const secret = await getSecret();
  if (!secret) {
    throw new Error('Admin auth secret is not configured');
  }
  const signature = await hmacSha256(secret, data);
  return `${data}.${signature}`;
}

/**
 * Validate a base64url-signed admin token and return its decoded payload.
 *
 * @param token - Signed token in the form `base64url(payload).base64url(hmac)` 
 * @returns The parsed `AdminTokenPayload` if the token is valid and the signature matches, `null` otherwise.
 */
async function verifyAdminToken(token: string): Promise<AdminTokenPayload | null> {
  if (!token || typeof token !== 'string') return null;
  const [data, signature] = token.split('.');
  if (!data || !signature) return null;

  const secret = await getSecret();
  if (!secret) return null;
  const expectedSignature = await hmacSha256(secret, data);

  const signatureBuffer = base64urlDecodeToBytes(signature);
  const expectedSignatureBuffer = base64urlDecodeToBytes(expectedSignature);

  // Prevent timing attacks using timingSafeEqualJS
  if (!timingSafeEqualJS(signatureBuffer, expectedSignatureBuffer)) {
    return null;
  }

  try {
    return JSON.parse(base64urlDecode(data)) as AdminTokenPayload;
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
    const rawCookie = req.cookies?.get?.(ADMIN_COOKIE)?.value;
    if (rawCookie) {
      cookieValue = rawCookie;
    } else {
      const match = req.headers.get('cookie')?.split(';').find(c => c.trim().startsWith(`${ADMIN_COOKIE}=`));
      cookieValue = match ? match.trim().slice(ADMIN_COOKIE.length + 1) : undefined;
    }
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
