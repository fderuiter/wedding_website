import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';
import { verifyGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import {
  getSignedGuestInviteSession,
  verifyGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteToken';
import { env } from '@/env';
import { normalizeSocketIp, readVerifiedSocketIp } from '@/lib/socket-ip-boundary.js';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

interface RateLimitStore {
  map: Map<string, RateLimitInfo>;
  earliestResetTime: number;
}

interface RateLimitBehaviorOptions {
  increment?: boolean;
}

export type RateLimitBucket = 'general' | 'auth';

export const MAX_RATE_LIMIT_KEYS = 10000;

const generalStore: RateLimitStore = {
  map: new Map<string, RateLimitInfo>(),
  earliestResetTime: Infinity,
};

const authStore: RateLimitStore = {
  map: new Map<string, RateLimitInfo>(),
  earliestResetTime: Infinity,
};

const KNOWN_STATIC_API_PATHS = new Set([
  '/api/admin/broadcast/history',
  '/api/admin/broadcast/preview',
  '/api/admin/broadcast/retry',
  '/api/admin/broadcast/send',
  '/api/admin/broadcast/test-connection',
  '/api/admin/broadcast/test-send',
  '/api/admin/features',
  '/api/admin/invitation-codes/batch',
  '/api/admin/invitation-codes/batch/validate',
  '/api/admin/invitation-codes/catalog',
  '/api/admin/invitation-codes/export',
  '/api/admin/invitation-codes/merge',
  '/api/admin/invitation-codes/rsvps',
  '/api/admin/invitation-codes/validate',
  '/api/admin/login',
  '/api/admin/logout',
  '/api/admin/maintenance/export',
  '/api/admin/maintenance/import',
  '/api/admin/me',
  '/api/admin/onboarding-milestones',
  '/api/admin/photos/moderation',
  '/api/admin/photos/moderation/batch',
  '/api/admin/sample-data',
  '/api/admin/seating/assign',
  '/api/admin/seating/auto-assign',
  '/api/admin/seating/export',
  '/api/admin/settings',
  '/api/admin/setup',
  '/api/admin/sub-events/access',
  '/api/admin/sub-events/access/batch',
  '/api/admin/sub-events/rsvp-summary',
  '/api/admin/thank-you-notes',
  '/api/admin/thank-you-notes/batch',
  '/api/admin/thank-you-notes/export',
  '/api/admin/thank-you-notes/export-labels',
  '/api/admin/upload',
  '/api/admin/versions',
  '/api/cron/broadcasts',
  '/api/guest/address',
  '/api/guest/address/public',
  '/api/guest/login',
  '/api/guest/lookup',
  '/api/guest/photos/upload',
  '/api/health',
  '/api/live',
  '/api/media',
  '/api/media/export',
  '/api/photos',
  '/api/photos/upload',
  '/api/ready',
  '/api/registry/capabilities',
  '/api/registry/claim',
  '/api/registry/contribute',
  '/api/registry/items',
  '/api/registry/items/batch',
  '/api/registry/payment-intent',
  '/api/registry/scrape',
  '/api/registry/scrape/batch',
  '/api/registry/session',
  '/api/registry/validate-code',
  '/api/registry/webhook/stripe',
  '/api/rsvp',
  '/api/schedule',
  '/api/weather',
]);

const STATIC_ADMIN_NAMESPACES = new Set([
  'broadcast',
  'invitation-codes',
  'maintenance',
  'photos',
  'seating',
  'sub-events',
  'thank-you-notes',
  'versions',
]);

function isAuthLockoutRoute(pathname: string, method: string = 'GET'): boolean {
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  const upperMethod = method.toUpperCase();
  return (
    normalized === '/api/admin/login' ||
    normalized === '/api/guest/login' ||
    normalized === '/api/guest/lookup' ||
    (normalized === '/api/admin/setup' && upperMethod === 'POST') ||
    normalized === '/api/registry/validate-code'
  );
}

export function normalizeApiPathname(pathname: string): string {
  if (!pathname) return '';
  const cleaned = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  if (!cleaned.startsWith('/api/')) {
    return cleaned;
  }

  if (KNOWN_STATIC_API_PATHS.has(cleaned)) {
    return cleaned;
  }

  if (/^\/api\/admin\/broadcast\/schedule\/[^/]+$/.test(cleaned)) {
    return '/api/admin/broadcast/schedule/:id';
  }
  if (/^\/api\/admin\/broadcast\/(?!(?:history|preview|retry|send|test-connection|test-send)$)[^/]+$/.test(cleaned)) {
    return '/api/admin/broadcast/:id';
  }
  if (/^\/api\/admin\/contributors\/[^/]+\/action$/.test(cleaned)) {
    return '/api/admin/contributors/:id/action';
  }
  if (/^\/api\/admin\/photos\/(?!moderation$)[^/]+$/.test(cleaned)) {
    return '/api/admin/photos/:id';
  }
  if (/^\/api\/admin\/registry\/items\/[^/]+\/unclaim$/.test(cleaned)) {
    return '/api/admin/registry/items/:id/unclaim';
  }
  if (/^\/api\/admin\/thank-you-notes\/(?!(?:batch|export|export-labels)$)[^/]+$/.test(cleaned)) {
    return '/api/admin/thank-you-notes/:id';
  }
  if (/^\/api\/admin\/versions\/[^/]+\/restore$/.test(cleaned)) {
    return '/api/admin/versions/:id/restore';
  }
  if (/^\/api\/media\/(?!export$)[^/]+$/.test(cleaned)) {
    return '/api/media/:id';
  }
  if (/^\/api\/registry\/items\/(?!batch$)[^/]+$/.test(cleaned)) {
    return '/api/registry/items/:id';
  }
  if (/^\/api\/schedule\/[^/]+\/ics$/.test(cleaned)) {
    return '/api/schedule/:id/ics';
  }
  if (/^\/api\/uploads\/.+$/.test(cleaned)) {
    return '/api/uploads/:path';
  }

  const segments = cleaned.split('/').filter(Boolean); // segments[0] === 'api'
  if (segments[1] === 'admin' && segments.length >= 3) {
    const adminSeg = segments[2];
    if (!STATIC_ADMIN_NAMESPACES.has(adminSeg)) {
      if (segments.length === 3) {
        return '/api/admin/:entity';
      }
      if (segments.length === 4 && segments[3] === 'batch') {
        return '/api/admin/:entity/batch';
      }
      return '/api/admin/:entity/:id';
    }
    return `/api/admin/${adminSeg}/:id`;
  }

  if (segments.length === 2) {
    return /^[a-z-]+$/.test(segments[1]) ? cleaned : '/api/:id';
  }

  const firstSubSegment = /^[a-z-]+$/.test(segments[1]) ? segments[1] : ':id';
  return firstSubSegment === ':id' ? '/api/:id' : `/api/${firstSubSegment}/:id`;
}

function pruneExpiredEntries(store: RateLimitStore, now: number): void {
  if (now < store.earliestResetTime) return;
  let newEarliest = Infinity;
  for (const [k, v] of store.map.entries()) {
    if (v.resetTime < now) {
      store.map.delete(k);
    } else if (v.resetTime < newEarliest) {
      newEarliest = v.resetTime;
    }
  }
  store.earliestResetTime = store.map.size === 0 ? Infinity : newEarliest;
}

function getClientIp(req: NextRequest): string {
  const trustProxy = env.TRUST_PROXY;

  // 1. When TRUST_PROXY is disabled, never trust X-Forwarded-For or X-Real-IP;
  //    read only the HMAC-verified internal socket IP stamped at the HTTP boundary.
  if (!trustProxy) {
    return readVerifiedSocketIp(req.headers) ?? '127.0.0.1';
  }

  const hops = typeof trustProxy === 'number' ? Math.max(1, Math.trunc(trustProxy)) : 1;

  // 2. Evaluate trusted hop in x-forwarded-for header from reverse proxy
  const rawForwarded = req.headers.get('x-forwarded-for');
  if (rawForwarded) {
    const parts = rawForwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const candidate = parts[Math.max(0, parts.length - hops)];
      return normalizeSocketIp(candidate) ?? candidate;
    }
  }

  // 3. Fallback: x-real-ip when x-forwarded-for is missing and proxy trust is enabled
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    const trimmed = realIp.trim();
    return normalizeSocketIp(trimmed) ?? trimmed;
  }

  // 4. Fall back to verified socket IP or loopback IP when no forwarded address exists
  return readVerifiedSocketIp(req.headers) ?? '127.0.0.1';
}

function readRawCookieFromRequest(req: NextRequest, cookieName: string): string | undefined {
  const directCookie = req.cookies?.get?.(cookieName)?.value;
  if (directCookie) {
    return directCookie;
  }
  if (typeof req.headers?.get !== 'function') {
    return undefined;
  }
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) {
    return undefined;
  }
  const match = cookieHeader
    .split(';')
    .map((segment) => segment.trim())
    .find((segment) => segment.startsWith(`${cookieName}=`));
  return match ? match.slice(cookieName.length + 1) : undefined;
}

async function getSessionOrIp(req: NextRequest): Promise<string> {
  const adminCookieName = ADMIN_COOKIE || 'admin_auth';
  const adminCookie = readRawCookieFromRequest(req, adminCookieName);
  if (adminCookie) {
    try {
      if (typeof verifyAdminToken === 'function') {
        const payload = await verifyAdminToken(adminCookie);
        if (payload && payload.isAdmin === true) {
          return `session:${adminCookie}`;
        }
      }
    } catch {
      // Malformed or invalid admin cookie falls through
    }
  }

  const inviteCookieName = GUEST_INVITE_COOKIE || 'guest_invite_session';
  const inviteCookie = readRawCookieFromRequest(req, inviteCookieName);
  if (inviteCookie) {
    try {
      const payload =
        typeof getSignedGuestInviteSession === 'function'
          ? await getSignedGuestInviteSession(req)
          : typeof verifyGuestInviteSessionToken === 'function'
            ? await verifyGuestInviteSessionToken(inviteCookie)
            : null;
      if (payload && payload.code && payload.guestName) {
        return `session:invite:${inviteCookie}`;
      }
    } catch {
      // Malformed or invalid guest invite cookie falls through
    }
  }

  const guestCookieName = GUEST_COOKIE || 'guest_auth';
  const guestCookie = readRawCookieFromRequest(req, guestCookieName);
  if (guestCookie) {
    try {
      if (typeof verifyGuestToken === 'function') {
        const payload = await verifyGuestToken(guestCookie);
        if (payload && payload.guest === true) {
          return `session:guest:${guestCookie}`;
        }
      }
    } catch {
      // Malformed or invalid guest cookie falls through
    }
  }

  return getClientIp(req);
}

export async function rateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number,
  keyPrefix?: string,
  bucket?: RateLimitBucket,
  behavior?: RateLimitBehaviorOptions
): Promise<NextResponse | null> {
  let rawPathname = '';
  try {
    rawPathname = req.nextUrl?.pathname || (req.url ? new URL(req.url, 'http://localhost').pathname : '');
  } catch {
    rawPathname = '';
  }

  const method = req.method || 'GET';
  const isLockoutEndpoint = isAuthLockoutRoute(rawPathname, method);
  const resolvedBucket: RateLimitBucket =
    bucket ?? (isLockoutEndpoint ? 'auth' : 'general');
  const identifier =
    resolvedBucket === 'auth' || isLockoutEndpoint
      ? getClientIp(req)
      : await getSessionOrIp(req);
  const store = resolvedBucket === 'auth' ? authStore : generalStore;
  const shouldIncrement = behavior?.increment !== false;

  const normalizedPathname = normalizeApiPathname(rawPathname);
  const key = keyPrefix ? `${keyPrefix}:${identifier}` : `${normalizedPathname}:${identifier}`;

  const now = Date.now();
  const info = store.map.get(key);

  if (!info || info.resetTime < now) {
    pruneExpiredEntries(store, now);
    if (!shouldIncrement) {
      return null;
    }
    if (!store.map.has(key)) {
      while (store.map.size >= MAX_RATE_LIMIT_KEYS) {
        const oldestKey = store.map.keys().next().value;
        if (oldestKey !== undefined) {
          store.map.delete(oldestKey);
        } else {
          break;
        }
      }
    }
    const resetTime = now + windowMs;
    store.map.set(key, { count: 1, resetTime });
    if (resetTime < store.earliestResetTime) {
      store.earliestResetTime = resetTime;
    }
    return null;
  }

  if (info.count >= limit) {
    return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
  }

  if (shouldIncrement) {
    info.count += 1;
  }
  return null;
}

export async function checkAuthLockout(
  req: NextRequest,
  limit: number = 5,
  windowMs: number = 15 * 60 * 1000,
  keyPrefix?: string
): Promise<NextResponse | null> {
  return rateLimit(req, limit, windowMs, keyPrefix, 'auth', { increment: false });
}

export async function recordFailedAuthAttempt(
  req: NextRequest,
  limit: number = 5,
  windowMs: number = 15 * 60 * 1000,
  keyPrefix?: string
): Promise<void> {
  await rateLimit(req, limit, windowMs, keyPrefix, 'auth', { increment: true });
}

/**
 * @internal Reset rate limits for testing purposes only.
 */
export function resetRateLimitsForTesting() {
  generalStore.map.clear();
  generalStore.earliestResetTime = Infinity;
  authStore.map.clear();
  authStore.earliestResetTime = Infinity;
}

/**
 * @internal Get general rate limits count for testing purposes only.
 */
export function getRateLimitsCountForTesting(): number {
  return generalStore.map.size;
}

/**
 * @internal Get general rate limits map for testing purposes only.
 */
export function getRateLimitsForTesting(): Map<string, RateLimitInfo> {
  return generalStore.map;
}

/**
 * @internal Get auth rate limits count for testing purposes only.
 */
export function getAuthRateLimitsCountForTesting(): number {
  return authStore.map.size;
}

/**
 * @internal Get auth rate limits map for testing purposes only.
 */
export function getAuthRateLimitsForTesting(): Map<string, RateLimitInfo> {
  return authStore.map;
}
