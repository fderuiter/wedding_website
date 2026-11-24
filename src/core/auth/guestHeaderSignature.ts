import { env } from '@/env';
import {
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';
import type { HeadersLookup } from '@/utils/hostValidation';

export const GUEST_GATED_PAGE_HEADER = 'x-guest-gated-page';
export const GUEST_CALLBACK_URL_HEADER = 'x-guest-callback-url';
export const GUEST_HEADER_SIGNATURE_HEADER = 'x-guest-header-signature';

const GUEST_INTERNAL_HEADER_DOMAIN = 'wedding-website:guest-internal-headers:v1';

export function resolveGuestSigningSecret(): string {
  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  const fallback = isProduction ? '' : 'default-guest-session-secret';
  const secret = isProduction
    ? (process.env.GUEST_SESSION_SECRET || fallback)
    : (env.GUEST_SESSION_SECRET || process.env.GUEST_SESSION_SECRET || fallback);
  const passcode = isProduction
    ? (process.env.GUEST_PASSCODE || 'wedding2026')
    : (env.GUEST_PASSCODE || process.env.GUEST_PASSCODE || 'wedding2026');

  if (isProduction) {
    if (!secret || secret === 'default-guest-session-secret') {
      throw new Error('GUEST_SESSION_SECRET must be configured with a distinct secret in production');
    }
    if (secret.length < 32) {
      throw new Error('GUEST_SESSION_SECRET must be at least 32 characters long in production');
    }
  }

  if (secret === passcode) {
    throw new Error('GUEST_SESSION_SECRET must not use the value of GUEST_PASSCODE');
  }

  return secret;
}

function buildGuestHeaderSigningPayload(gatedPage: '0' | '1', callbackUrl: string): string {
  return `${GUEST_INTERNAL_HEADER_DOMAIN}\n${gatedPage}\n${callbackUrl}`;
}

/**
 * Strips any untrusted client-supplied `x-guest-*` headers before middleware sets internal
 * gating metadata.
 */
export function stripClientGuestHeaders(headers: Headers): void {
  const keysToDelete: string[] = [];
  headers.forEach((_value, key) => {
    if (key.toLowerCase().startsWith('x-guest-')) {
      keysToDelete.push(key);
    }
  });
  for (const key of keysToDelete) {
    headers.delete(key);
  }
}

/**
 * Signs internal `x-guest-gated-page` and `x-guest-callback-url` headers with `GUEST_SESSION_SECRET`.
 */
export async function signGuestInternalHeaders(
  gatedPage: '0' | '1',
  callbackUrl: string
): Promise<string | null> {
  try {
    const secret = resolveGuestSigningSecret();
    if (!secret) {
      return null;
    }
    return await hmacSha256(secret, buildGuestHeaderSigningPayload(gatedPage, callbackUrl));
  } catch {
    return null;
  }
}

/**
 * Verifies the HMAC stamp over `x-guest-gated-page` and `x-guest-callback-url` using constant-time
 * comparison. Returns `valid: false` whenever headers or signature are missing or forged.
 */
export async function verifyGuestInternalHeaders(
  headers: HeadersLookup | null | undefined
): Promise<{
  valid: boolean;
  gatedPage: '0' | '1' | null;
  callbackUrl: string | null;
}> {
  if (!headers || typeof headers.get !== 'function') {
    return { valid: false, gatedPage: null, callbackUrl: null };
  }

  const rawGatedPage = headers.get(GUEST_GATED_PAGE_HEADER);
  const rawCallbackUrl = headers.get(GUEST_CALLBACK_URL_HEADER) ?? '';
  const rawSignature = headers.get(GUEST_HEADER_SIGNATURE_HEADER);

  if (
    (rawGatedPage !== '0' && rawGatedPage !== '1') ||
    typeof rawSignature !== 'string' ||
    !rawSignature.trim()
  ) {
    return { valid: false, gatedPage: null, callbackUrl: null };
  }

  try {
    const expectedSignature = await signGuestInternalHeaders(rawGatedPage, rawCallbackUrl);
    if (!expectedSignature) {
      return { valid: false, gatedPage: null, callbackUrl: null };
    }

    const actualBytes = base64urlDecodeToBytes(rawSignature.trim());
    const expectedBytes = base64urlDecodeToBytes(expectedSignature);
    if (!timingSafeEqualJS(actualBytes, expectedBytes)) {
      return { valid: false, gatedPage: null, callbackUrl: null };
    }

    return {
      valid: true,
      gatedPage: rawGatedPage,
      callbackUrl: rawCallbackUrl || null,
    };
  } catch {
    return { valid: false, gatedPage: null, callbackUrl: null };
  }
}
