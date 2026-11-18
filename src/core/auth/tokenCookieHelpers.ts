import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import {
  base64urlEncode,
  base64urlDecode,
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';

interface ReadRequestCookieOptions {
  suppressErrors?: boolean;
}

/**
 * Signs a JSON-serializable object payload into a compact `base64url(payload).base64url(signature)` token.
 *
 * @param payload - Plain object payload to serialize and sign
 * @param secret - Non-empty HMAC-SHA256 signing secret
 * @returns Compact signed token string
 */
export async function signCompactToken(payload: object, secret: string): Promise<string> {
  if (!secret) {
    throw new Error('Token signing secret is not configured');
  }
  const data = base64urlEncode(JSON.stringify(payload));
  const signature = await hmacSha256(secret, data);
  return `${data}.${signature}`;
}

/**
 * Verifies a compact `base64url(payload).base64url(signature)` token using constant-time byte comparison
 * and parses the decoded JSON object payload.
 *
 * @param token - Compact signed token string
 * @param secret - Non-empty HMAC-SHA256 signing secret
 * @returns Parsed payload object if valid, or `null` if malformed or signature check fails
 */
export async function verifyCompactToken<T extends object = Record<string, unknown>>(
  token: string,
  secret: string
): Promise<T | null> {
  if (!token || typeof token !== 'string' || !secret) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }

  const [data, signature] = parts;
  if (!data || !signature) {
    return null;
  }

  try {
    const expectedSignature = await hmacSha256(secret, data);
    const signatureBuffer = base64urlDecodeToBytes(signature);
    const expectedSignatureBuffer = base64urlDecodeToBytes(expectedSignature);

    if (!timingSafeEqualJS(signatureBuffer, expectedSignatureBuffer)) {
      return null;
    }

    const parsed: unknown = JSON.parse(base64urlDecode(data));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    return parsed as T;
  } catch {
    return null;
  }
}

/**
 * Reads a named cookie from `NextRequest.cookies`, falls back to the raw `cookie` request header,
 * or reads from Next.js `cookies()` in Server Component contexts when `req` is omitted.
 *
 * @param cookieName - Name of the cookie to look up
 * @param req - Optional `NextRequest` in middleware or Route Handler contexts
 * @param options - Optional behavior flags (`suppressErrors` catches `cookies()` errors)
 * @returns Cookie value string if found, or `undefined`
 */
export async function readRequestCookie(
  cookieName: string,
  req?: NextRequest,
  options?: ReadRequestCookieOptions
): Promise<string | undefined> {
  if (req) {
    const rawCookie = req.cookies?.get?.(cookieName)?.value;
    if (rawCookie) {
      return rawCookie;
    }
    const cookieHeader = typeof req.headers?.get === 'function' ? req.headers.get('cookie') : null;
    const match = cookieHeader
      ?.split(';')
      .find((c) => c.trim().startsWith(`${cookieName}=`));
    return match ? match.trim().slice(cookieName.length + 1) : undefined;
  }

  if (options?.suppressErrors) {
    try {
      const cookieStore = await cookies();
      return cookieStore.get(cookieName)?.value;
    } catch {
      return undefined;
    }
  }

  const cookieStore = await cookies();
  return cookieStore.get(cookieName)?.value;
}
