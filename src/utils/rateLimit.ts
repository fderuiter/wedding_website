import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';
import { env } from '@/env';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

interface RateLimitStore {
  map: Map<string, RateLimitInfo>;
  earliestResetTime: number;
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
  if (/^\/api\/admin\/photos\/(?!moderation$)[^/]+$/.test(cleaned)) {
    return '/api/admin/photos/:id';
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
  // 1. Prioritize req.ip from Next.js runtime when available
  const reqIp = (req as { ip?: string }).ip;
  if (reqIp) {
    return reqIp;
  }

  // 2. Only inspect X-Forwarded-For / X-Real-IP when TRUST_PROXY is explicitly enabled
  const trustProxy = env.TRUST_PROXY;
  if (!trustProxy) {
    return '127.0.0.1';
  }

  const hops = typeof trustProxy === 'number' ? Math.max(1, Math.trunc(trustProxy)) : 1;

  // 3. Evaluate trusted hop in x-forwarded-for header from reverse proxy
  const rawForwarded = req.headers.get('x-forwarded-for');
  if (rawForwarded) {
    const parts = rawForwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[Math.max(0, parts.length - hops)];
    }
  }

  // 4. Fallback: x-real-ip when x-forwarded-for is missing and proxy trust is enabled
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  // 5. Fall back to loopback IP when no trusted address exists
  return '127.0.0.1';
}

async function getSessionOrIp(req: NextRequest): Promise<string> {
  const cookieName = ADMIN_COOKIE || 'admin_auth';
  const adminCookie =
    req.cookies?.get?.(cookieName)?.value ||
    (typeof req.headers?.get === 'function'
      ? req.headers.get('cookie')?.split(';').find((c) => c.trim().startsWith(`${cookieName}=`))?.trim().slice(cookieName.length + 1)
      : undefined);

  if (adminCookie) {
    try {
      if (typeof verifyAdminToken === 'function') {
        const payload = await verifyAdminToken(adminCookie);
        if (payload && payload.isAdmin === true) {
          return `session:${adminCookie}`;
        }
      }
    } catch {
      // Malformed or invalid cookie falls back to client IP
    }
  }
  return getClientIp(req);
}

export async function rateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number,
  keyPrefix?: string,
  bucket?: RateLimitBucket
): Promise<NextResponse | null> {
  const identifier = await getSessionOrIp(req);

  let rawPathname = '';
  try {
    rawPathname = req.nextUrl?.pathname || (req.url ? new URL(req.url, 'http://localhost').pathname : '');
  } catch {
    rawPathname = '';
  }

  const method = req.method || 'GET';
  const resolvedBucket: RateLimitBucket =
    bucket ?? (isAuthLockoutRoute(rawPathname, method) ? 'auth' : 'general');
  const store = resolvedBucket === 'auth' ? authStore : generalStore;

  const normalizedPathname = normalizeApiPathname(rawPathname);
  const key = keyPrefix ? `${keyPrefix}:${identifier}` : `${normalizedPathname}:${identifier}`;

  const now = Date.now();
  const info = store.map.get(key);

  if (!info || info.resetTime < now) {
    pruneExpiredEntries(store, now);
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

  info.count += 1;
  return null;
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
