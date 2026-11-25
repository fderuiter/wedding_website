import { cookies } from 'next/headers';
import type { NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import { isLocalOrInternalHostname } from '@/lib/trustProxyPolicy';
import {
  base64urlEncode,
  base64urlDecode,
  base64urlDecodeToBytes,
  hmacSha256,
  timingSafeEqualJS,
} from '@/utils/crypto';
import {
  isHostAllowed,
  parseHostHeader,
  resolveRequestHost,
  resolveRequestProtocol,
} from '@/utils/hostValidation';

const HOST_COOKIE_PREFIX = '__Host-';

interface ReadRequestCookieOptions {
  suppressErrors?: boolean;
}

interface CookieContextRequest {
  url?: string;
  headers?: {
    get?: (_name: string) => string | null;
  };
  nextUrl?: {
    protocol?: string;
    hostname?: string;
    host?: string;
  };
}

function stripHostCookiePrefix(cookieName: string): string {
  return cookieName.startsWith(HOST_COOKIE_PREFIX)
    ? cookieName.slice(HOST_COOKIE_PREFIX.length)
    : cookieName;
}

function hasSecureConfiguredSiteOrigin(): boolean {
  const rawSiteBaseUrl = process.env.SITE_BASE_URL?.trim();
  if (!rawSiteBaseUrl) return false;
  try {
    return new URL(rawSiteBaseUrl).protocol.toLowerCase() === 'https:';
  } catch {
    return false;
  }
}

/**
 * Determines whether session cookies should be issued with the `__Host-` prefix and `Secure`
 * flag. Returns `true` in production over HTTPS, on approved non-local hosts (even when internal
 * proxy-to-container traffic uses plain HTTP), on non-local requests with an `https:`
 * `SITE_BASE_URL`, or when request context is omitted; returns `false` on plain HTTP local
 * development or loopback servers because browsers reject `__Host-` cookies without `Secure`.
 */
function isSecureCookieContext(req?: CookieContextRequest): boolean {
  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  if (!isProduction) {
    return false;
  }

  if (!req) {
    return true;
  }

  let parsedUrl: URL | null = null;
  if (typeof req.url === 'string' && req.url) {
    try {
      parsedUrl = new URL(req.url, 'http://localhost');
    } catch {
      parsedUrl = null;
    }
  }

  const fallbackProtocol =
    req.nextUrl?.protocol?.toLowerCase() || parsedUrl?.protocol?.toLowerCase();
  const headersLookup =
    typeof req.headers?.get === 'function'
      ? { get: (name: string) => req.headers!.get!(name) }
      : null;
  const resolvedProto = resolveRequestProtocol(headersLookup, fallbackProtocol);
  if (resolvedProto === 'https') {
    return true;
  }

  const fallbackHost = req.nextUrl?.host || parsedUrl?.host || req.nextUrl?.hostname || null;
  const effectiveHost = resolveRequestHost(headersLookup, fallbackHost);
  const parsedHost = effectiveHost ? parseHostHeader(effectiveHost) : null;
  const effectiveHostname =
    parsedHost?.hostname ||
    req.nextUrl?.hostname?.toLowerCase() ||
    parsedUrl?.hostname?.toLowerCase() ||
    '';

  if (effectiveHostname && isLocalOrInternalHostname(effectiveHostname)) {
    return false;
  }

  if ((effectiveHost && isHostAllowed(effectiveHost)) || hasSecureConfiguredSiteOrigin()) {
    return true;
  }

  if (resolvedProto === 'http') {
    return false;
  }

  return true;
}

/**
 * Resolves the cookie name to write for a session cookie (`__Host-<name>` over HTTPS in
 * production, or unprefixed `<name>` on plain HTTP local development and loopback test servers).
 */
export function resolveSessionCookieName(
  baseCookieName: string,
  req?: CookieContextRequest
): string {
  const unprefixed = stripHostCookiePrefix(baseCookieName);
  return isSecureCookieContext(req) ? `${HOST_COOKIE_PREFIX}${unprefixed}` : unprefixed;
}

/**
 * Builds standard `HttpOnly`, `SameSite=Lax`, `Path=/` cookie options without a `Domain`
 * attribute, setting `Secure` whenever `isSecureCookieContext(req)` is `true`.
 */
export function getSessionCookieOptions(maxAge: number, req?: CookieContextRequest) {
  return {
    httpOnly: true,
    secure: isSecureCookieContext(req),
    sameSite: 'lax' as const,
    path: '/',
    maxAge,
  };
}

function hasRawNamedCookie(req: CookieContextRequest | undefined, exactCookieName: string): boolean {
  if (!req) return false;
  const anyReq = req as NextRequest;
  if (anyReq.cookies?.get?.(exactCookieName)?.value) {
    return true;
  }
  const rawHeader =
    typeof req.headers?.get === 'function' ? req.headers.get('cookie') : null;
  if (!rawHeader) return false;
  return rawHeader.split(';').some((part) => {
    const trimmed = part.trim();
    const eqIndex = trimmed.indexOf('=');
    return eqIndex > 0 && trimmed.slice(0, eqIndex).trim() === exactCookieName;
  });
}

/**
 * Clears the active session cookie (`__Host-<name>` on HTTPS production or `<name>` on HTTP),
 * and also expires any stale counterpart cookie present on the incoming request.
 */
export function clearSessionCookie(
  response: NextResponse,
  baseCookieName: string,
  req?: CookieContextRequest
): NextResponse {
  const unprefixed = stripHostCookiePrefix(baseCookieName);
  const hostPrefixed = `${HOST_COOKIE_PREFIX}${unprefixed}`;
  const secureContext = isSecureCookieContext(req);
  const primaryName = secureContext ? hostPrefixed : unprefixed;

  response.cookies.set(primaryName, '', getSessionCookieOptions(0, req));

  if (secureContext && hasRawNamedCookie(req, unprefixed)) {
    response.cookies.set(unprefixed, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
  }

  return response;
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

function appendCandidateValue(
  candidates: string[],
  seen: Set<string>,
  rawValue: string | undefined
): void {
  if (!rawValue) return;
  if (!seen.has(rawValue)) {
    seen.add(rawValue);
    candidates.push(rawValue);
  }
  try {
    const decoded = decodeURIComponent(rawValue);
    if (decoded && !seen.has(decoded)) {
      seen.add(decoded);
      candidates.push(decoded);
    }
  } catch {
    // Keep raw value when percent-decoding fails
  }
}

/**
 * Collects all matching cookie values in priority order: `__Host-<name>` entries first,
 * followed by unprefixed `<name>` entries, across `NextRequest.cookies` and every matching
 * segment of the raw `Cookie` header (or `next/headers` `cookies()` when `req` is omitted).
 */
export async function readRequestCookieCandidates(
  cookieName: string,
  req?: NextRequest,
  options?: ReadRequestCookieOptions
): Promise<string[]> {
  const unprefixed = stripHostCookiePrefix(cookieName);
  const candidateNames = [`${HOST_COOKIE_PREFIX}${unprefixed}`, unprefixed];
  const candidates: string[] = [];
  const seen = new Set<string>();

  if (req) {
    const cookieHeader =
      typeof req.headers?.get === 'function' ? req.headers.get('cookie') : null;
    const headerParts = cookieHeader ? cookieHeader.split(';') : [];

    for (const name of candidateNames) {
      const singleVal = req.cookies?.get?.(name)?.value;
      appendCandidateValue(candidates, seen, singleVal);

      if (typeof req.cookies?.getAll === 'function') {
        try {
          const allEntries = req.cookies.getAll(name);
          if (Array.isArray(allEntries)) {
            for (const entry of allEntries) {
              if (!entry) continue;
              if ('name' in entry && entry.name && entry.name !== name) continue;
              appendCandidateValue(candidates, seen, entry.value);
            }
          }
        } catch {
          // Ignore incompatible getAll mock signatures
        }
      }

      for (const part of headerParts) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex <= 0) continue;
        const entryName = trimmed.slice(0, eqIndex).trim();
        if (entryName === name) {
          const rawVal = trimmed.slice(eqIndex + 1);
          appendCandidateValue(candidates, seen, rawVal);
        }
      }
    }

    return candidates;
  }

  let cookieStore: Awaited<ReturnType<typeof cookies>>;
  if (options?.suppressErrors) {
    try {
      cookieStore = await cookies();
    } catch {
      return [];
    }
  } else {
    cookieStore = await cookies();
  }

  for (const name of candidateNames) {
    const singleVal = cookieStore.get?.(name)?.value;
    appendCandidateValue(candidates, seen, singleVal);

    if (typeof cookieStore.getAll === 'function') {
      try {
        const allEntries = cookieStore.getAll(name);
        if (Array.isArray(allEntries)) {
          for (const entry of allEntries) {
            if (!entry) continue;
            if ('name' in entry && entry.name && entry.name !== name) continue;
            appendCandidateValue(candidates, seen, entry.value);
          }
        }
      } catch {
        // Ignore incompatible getAll mock signatures
      }
    }
  }

  return candidates;
}

/**
 * Reads a named cookie from `NextRequest.cookies`, falls back to the raw `cookie` request header,
 * or reads from Next.js `cookies()` in Server Component contexts when `req` is omitted,
 * preferring `__Host-` prefixed cookies when present.
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
  const candidates = await readRequestCookieCandidates(cookieName, req, options);
  return candidates[0];
}

/**
 * Evaluates every matching cookie candidate (`__Host-<name>` first, then `<name>`, across
 * duplicate `Cookie` header entries) until `verifyToken` succeeds. Prevents parent-domain or
 * path-scoped shadowed cookies from masking a valid session cookie.
 */
export async function findVerifiedRequestCookie<T>(
  cookieName: string,
  req: NextRequest | undefined,
  verifyToken: (_token: string) => Promise<T | null>,
  options?: ReadRequestCookieOptions
): Promise<{ token: string; payload: T } | null> {
  const candidates = await readRequestCookieCandidates(cookieName, req, options);
  for (const token of candidates) {
    try {
      const payload = await verifyToken(token);
      if (payload !== null && payload !== undefined) {
        return { token, payload };
      }
    } catch {
      // Malformed candidate falls through to next matching cookie entry
    }
  }
  return null;
}
