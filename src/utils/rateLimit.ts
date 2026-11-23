import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import type { Pool, QueryResultRow } from 'pg';
import { verifyAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';
import { verifyGuestSessionToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import { verifyGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteToken';
import { env } from '@/env';
import { logger } from '@/lib/logger';
import * as prismaModule from '@/lib/prisma';

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
const AUTH_LOCKOUT_QUERY_TIMEOUT_MS = 1000;
const DB_PRUNE_INTERVAL_MS = 60 * 1000;

const generalStore: RateLimitStore = {
  map: new Map<string, RateLimitInfo>(),
  earliestResetTime: Infinity,
};

const authStore: RateLimitStore = {
  map: new Map<string, RateLimitInfo>(),
  earliestResetTime: Infinity,
};

let hasWarnedUntrustedProxyHeaders = false;
let testPoolOverride: Pool | null | undefined = undefined;
let pendingResetPromise: Promise<void> | null = null;
let lastDbPruneAt = 0;

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

function ensureStoreCapacityForKey(store: RateLimitStore, key: string, now: number): void {
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
}

function syncStoreEntry(store: RateLimitStore, key: string, info: RateLimitInfo, now: number): void {
  ensureStoreCapacityForKey(store, key, now);
  store.map.set(key, info);
  if (info.resetTime < store.earliestResetTime) {
    store.earliestResetTime = info.resetTime;
  }
}

function incrementStoreEntry(store: RateLimitStore, key: string, windowMs: number, now: number): RateLimitInfo {
  const existing = store.map.get(key);
  if (!existing || existing.resetTime < now) {
    const nextInfo: RateLimitInfo = { count: 1, resetTime: now + windowMs };
    syncStoreEntry(store, key, nextInfo, now);
    return nextInfo;
  }
  existing.count += 1;
  return existing;
}

function isStoreEntryLockedOut(store: RateLimitStore, key: string, limit: number, now: number): boolean {
  const existing = store.map.get(key);
  if (!existing) return false;
  if (existing.resetTime < now) {
    store.map.delete(key);
    return false;
  }
  return existing.count >= limit;
}

/**
 * Sanitizes a single forwarded IP token by trimming quotes/whitespace, stripping
 * port suffixes on IPv4 (`1.2.3.4:54321`) and bracketed IPv6 (`[2001:db8::1]:8443`),
 * stripping IPv6 zone identifiers, and validating via `node:net` `isIP`.
 */
export function sanitizeIpToken(rawToken: string): string | null {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  let token = rawToken.trim();
  if (
    (token.startsWith('"') && token.endsWith('"')) ||
    (token.startsWith('\'') && token.endsWith('\''))
  ) {
    token = token.slice(1, -1).trim();
  }
  if (!token) {
    return null;
  }

  const bracketedMatch = token.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedMatch) {
    const ipv6Candidate = bracketedMatch[1].split('%')[0];
    return isIP(ipv6Candidate) === 6 ? ipv6Candidate.toLowerCase() : null;
  }

  const withoutZone = token.includes('%') ? token.split('%')[0] : token;
  const directVersion = isIP(withoutZone);
  if (directVersion === 4) {
    return withoutZone;
  }
  if (directVersion === 6) {
    return withoutZone.toLowerCase();
  }

  const ipv4WithPortMatch = withoutZone.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch && isIP(ipv4WithPortMatch[1]) === 4) {
    return ipv4WithPortMatch[1];
  }

  return null;
}

export function getClientIp(req: NextRequest): string {
  const trustProxy = env.TRUST_PROXY;
  if (!trustProxy) {
    const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
    if (isProduction && !hasWarnedUntrustedProxyHeaders && typeof req.headers?.get === 'function') {
      const hasForwardedFor = Boolean(req.headers.get('x-forwarded-for')?.trim());
      const hasRealIp = Boolean(req.headers.get('x-real-ip')?.trim());
      if (hasForwardedFor || hasRealIp) {
        hasWarnedUntrustedProxyHeaders = true;
        logger.warn(
          'Forwarded IP headers detected while TRUST_PROXY is disabled; rate limiting is falling back to 127.0.0.1. Configure TRUST_PROXY to match your reverse-proxy hop count.',
          {
            trustProxy: false,
            headers: [
              ...(hasForwardedFor ? ['x-forwarded-for'] : []),
              ...(hasRealIp ? ['x-real-ip'] : []),
            ],
          }
        );
      }
    }
    return '127.0.0.1';
  }

  const hops = typeof trustProxy === 'number' ? Math.max(1, Math.trunc(trustProxy)) : 1;

  const rawForwarded = typeof req.headers?.get === 'function' ? req.headers.get('x-forwarded-for') : null;
  if (rawForwarded) {
    const parts = rawForwarded
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 0) {
      const selectedHop = parts[Math.max(0, parts.length - hops)];
      const sanitizedForwarded = sanitizeIpToken(selectedHop);
      if (sanitizedForwarded) {
        return sanitizedForwarded;
      }
    }
  }

  const realIp = typeof req.headers?.get === 'function' ? req.headers.get('x-real-ip') : null;
  if (realIp) {
    const sanitizedRealIp = sanitizeIpToken(realIp);
    if (sanitizedRealIp) {
      return sanitizedRealIp;
    }
  }

  return '127.0.0.1';
}

function extractRequestCookie(req: NextRequest, cookieName: string): string | undefined {
  const fromCookies = req.cookies?.get?.(cookieName)?.value;
  if (fromCookies) {
    return fromCookies;
  }
  if (typeof req.headers?.get === 'function') {
    const rawCookieHeader = req.headers.get('cookie');
    if (rawCookieHeader) {
      for (const part of rawCookieHeader.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith(`${cookieName}=`)) {
          const rawVal = trimmed.slice(cookieName.length + 1);
          try {
            return decodeURIComponent(rawVal);
          } catch {
            return rawVal;
          }
        }
      }
    }
  }
  return undefined;
}

async function getSessionOrIp(req: NextRequest): Promise<string> {
  const adminCookieName = ADMIN_COOKIE || 'admin_auth';
  const adminCookie = extractRequestCookie(req, adminCookieName);
  if (adminCookie) {
    try {
      if (typeof verifyAdminToken === 'function') {
        const payload = await verifyAdminToken(adminCookie);
        if (payload && payload.isAdmin === true) {
          return `session:admin:${adminCookie}`;
        }
      }
    } catch {
      // Invalid or malformed admin cookie falls through
    }
  }

  const inviteCookieName = GUEST_INVITE_COOKIE || 'guest_invite_session';
  const inviteCookie = extractRequestCookie(req, inviteCookieName);
  if (inviteCookie) {
    try {
      if (typeof verifyGuestInviteSessionToken === 'function') {
        const payload = await verifyGuestInviteSessionToken(inviteCookie);
        if (payload && payload.code) {
          return `session:invite:${inviteCookie}`;
        }
      }
    } catch {
      // Invalid or malformed invite session cookie falls through
    }
  }

  const guestCookieName = GUEST_COOKIE || 'guest_auth';
  const guestCookie = extractRequestCookie(req, guestCookieName);
  if (guestCookie) {
    try {
      if (typeof verifyGuestSessionToken === 'function') {
        const payload = await verifyGuestSessionToken(guestCookie);
        if (payload && payload.guest === true) {
          return `session:guest:${guestCookie}`;
        }
      }
    } catch {
      // Invalid or malformed guest cookie falls through
    }
  }

  return getClientIp(req);
}

function extractRawPathname(req: NextRequest): string {
  try {
    return req.nextUrl?.pathname || (req.url ? new URL(req.url, 'http://localhost').pathname : '');
  } catch {
    return '';
  }
}

function buildRateLimitKey(rawPathname: string, identifier: string, keyPrefix?: string): string {
  const normalizedPathname = normalizeApiPathname(rawPathname);
  return keyPrefix ? `${keyPrefix}:${identifier}` : `${normalizedPathname}:${identifier}`;
}

/**
 * Hashes a client-IP-scoped lockout key with HMAC-SHA256 using GUEST_SESSION_SECRET
 * so raw IP addresses are never stored in PostgreSQL.
 */
export function hashAuthLockoutKey(rawKey: string): string {
  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  const secret = isProduction
    ? (process.env.GUEST_SESSION_SECRET || env.GUEST_SESSION_SECRET || '')
    : (env.GUEST_SESSION_SECRET || process.env.GUEST_SESSION_SECRET || 'default-guest-session-secret');
  return crypto.createHmac('sha256', secret).update(rawKey).digest('hex');
}

function isStaticExportMode(): boolean {
  return process.env.STATIC_EXPORT === 'true' || process.env.STATIC_EXPORT === '1';
}

function isMockedFunction(fn: unknown): boolean {
  return Boolean(
    fn &&
      typeof fn === 'function' &&
      '_isMockFunction' in fn &&
      (fn as { _isMockFunction?: boolean })._isMockFunction
  );
}

function resolveActivePgPool(poolOverride?: Pool | null): Pool | undefined {
  if (isStaticExportMode()) {
    return undefined;
  }
  if (poolOverride !== undefined) {
    return poolOverride ?? undefined;
  }
  if (testPoolOverride !== undefined) {
    return testPoolOverride ?? undefined;
  }
  if (
    (process.env.NODE_ENV || env.NODE_ENV) === 'test' &&
    isMockedFunction(prismaModule.prisma?.$disconnect)
  ) {
    return undefined;
  }
  if (typeof prismaModule.getPgPool === 'function') {
    const candidate = prismaModule.getPgPool();
    if (candidate && typeof candidate.query === 'function') {
      return candidate;
    }
  }
  return undefined;
}

interface AuthLockoutRow extends QueryResultRow {
  count: number | string;
  resetTimeMs: number | string;
}

async function queryPoolWithTimeout<T extends QueryResultRow>(
  pool: Pool,
  sql: string,
  values: unknown[],
  timeoutMs: number = AUTH_LOCKOUT_QUERY_TIMEOUT_MS
): Promise<{ rows: T[] } | null> {
  if (pendingResetPromise) {
    await pendingResetPromise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const safeQuery = pool.query<T>(sql, values).then(
      (res) => ({ rows: res.rows }),
      () => null
    );
    const timeoutPromise = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), timeoutMs);
      timer.unref?.();
    });
    return await Promise.race([safeQuery, timeoutPromise]);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export interface AuthLockoutInstance {
  checkLockout: (
    _req: NextRequest,
    _limit: number,
    _windowMs: number,
    _keyPrefix?: string
  ) => Promise<NextResponse | null>;
  recordFailure: (
    _req: NextRequest,
    _windowMs: number,
    _keyPrefix?: string
  ) => Promise<void>;
  getLocalStoreSize: () => number;
}

export function createAuthLockoutInstance(options?: {
  pool?: Pool | null;
  store?: RateLimitStore;
  queryTimeoutMs?: number;
}): AuthLockoutInstance {
  const localStore: RateLimitStore = options?.store ?? {
    map: new Map<string, RateLimitInfo>(),
    earliestResetTime: Infinity,
  };
  const queryTimeoutMs = options?.queryTimeoutMs ?? AUTH_LOCKOUT_QUERY_TIMEOUT_MS;

  const checkLockout = async (
    req: NextRequest,
    limit: number,
    _windowMs: number,
    keyPrefix?: string
  ): Promise<NextResponse | null> => {
    const clientIp = getClientIp(req);
    const rawPathname = extractRawPathname(req);
    const rawKey = buildRateLimitKey(rawPathname, clientIp, keyPrefix);
    const now = Date.now();
    const pool = resolveActivePgPool(options?.pool);

    if (pool) {
      const keyHash = hashAuthLockoutKey(rawKey);
      const dbResult = await queryPoolWithTimeout<AuthLockoutRow>(
        pool,
        `SELECT "count", (EXTRACT(EPOCH FROM "resetAt") * 1000)::double precision AS "resetTimeMs"
         FROM "AuthLockout"
         WHERE "keyHash" = $1 AND "resetAt" > to_timestamp($2 / 1000.0)`,
        [keyHash, now],
        queryTimeoutMs
      );

      if (dbResult !== null) {
        if (dbResult.rows.length > 0) {
          const dbCount = Number(dbResult.rows[0].count);
          const dbResetTime = Number(dbResult.rows[0].resetTimeMs);
          syncStoreEntry(localStore, rawKey, { count: dbCount, resetTime: dbResetTime }, now);
          if (dbCount >= limit) {
            return NextResponse.json(
              { error: 'Too many requests, please try again later.' },
              { status: 429 }
            );
          }
        }
        return null;
      }
      // PostgreSQL query timed out or errored: fail open to local in-memory store
    }

    if (isStoreEntryLockedOut(localStore, rawKey, limit, now)) {
      return NextResponse.json(
        { error: 'Too many requests, please try again later.' },
        { status: 429 }
      );
    }
    return null;
  };

  const recordFailure = async (
    req: NextRequest,
    windowMs: number,
    keyPrefix?: string
  ): Promise<void> => {
    const clientIp = getClientIp(req);
    const rawPathname = extractRawPathname(req);
    const rawKey = buildRateLimitKey(rawPathname, clientIp, keyPrefix);
    const now = Date.now();
    const resetTime = now + windowMs;
    const pool = resolveActivePgPool(options?.pool);

    if (pool) {
      if (now - lastDbPruneAt >= DB_PRUNE_INTERVAL_MS) {
        lastDbPruneAt = now;
        void Promise.resolve(
          pool.query('DELETE FROM "AuthLockout" WHERE "resetAt" <= to_timestamp($1 / 1000.0)', [now])
        ).catch(() => undefined);
      }

      const keyHash = hashAuthLockoutKey(rawKey);
      const dbResult = await queryPoolWithTimeout<AuthLockoutRow>(
        pool,
        `INSERT INTO "AuthLockout" ("keyHash", "count", "resetAt", "createdAt", "updatedAt")
         VALUES ($1, 1, to_timestamp($3 / 1000.0), to_timestamp($2 / 1000.0), to_timestamp($2 / 1000.0))
         ON CONFLICT ("keyHash") DO UPDATE
         SET
           "count" = CASE
             WHEN "AuthLockout"."resetAt" <= to_timestamp($2 / 1000.0) THEN 1
             ELSE "AuthLockout"."count" + 1
           END,
           "resetAt" = CASE
             WHEN "AuthLockout"."resetAt" <= to_timestamp($2 / 1000.0) THEN EXCLUDED."resetAt"
             ELSE "AuthLockout"."resetAt"
           END,
           "updatedAt" = to_timestamp($2 / 1000.0)
         RETURNING "count", (EXTRACT(EPOCH FROM "resetAt") * 1000)::double precision AS "resetTimeMs"`,
        [keyHash, now, resetTime],
        queryTimeoutMs
      );

      if (dbResult !== null && dbResult.rows.length > 0) {
        const dbCount = Number(dbResult.rows[0].count);
        const dbResetTime = Number(dbResult.rows[0].resetTimeMs);
        syncStoreEntry(localStore, rawKey, { count: dbCount, resetTime: dbResetTime }, now);
        return;
      }
      // PostgreSQL query timed out or errored: fall back to local in-memory store
    }

    incrementStoreEntry(localStore, rawKey, windowMs, now);
  };

  return {
    checkLockout,
    recordFailure,
    getLocalStoreSize: () => localStore.map.size,
  };
}

const defaultAuthLockoutInstance = createAuthLockoutInstance({ store: authStore });

export async function checkAuthLockout(
  req: NextRequest,
  limit: number,
  windowMs: number,
  keyPrefix?: string,
  instance: AuthLockoutInstance = defaultAuthLockoutInstance
): Promise<NextResponse | null> {
  return instance.checkLockout(req, limit, windowMs, keyPrefix);
}

export async function recordAuthFailure(
  req: NextRequest,
  windowMs: number,
  keyPrefix?: string,
  instance: AuthLockoutInstance = defaultAuthLockoutInstance
): Promise<void> {
  return instance.recordFailure(req, windowMs, keyPrefix);
}

export async function rateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number,
  keyPrefix?: string,
  bucket?: RateLimitBucket
): Promise<NextResponse | null> {
  const rawPathname = extractRawPathname(req);
  const method = req.method || 'GET';
  const resolvedBucket: RateLimitBucket =
    bucket ?? (isAuthLockoutRoute(rawPathname, method) ? 'auth' : 'general');

  if (resolvedBucket === 'auth') {
    const blocked = await checkAuthLockout(req, limit, windowMs, keyPrefix);
    if (blocked) {
      return blocked;
    }
    await recordAuthFailure(req, windowMs, keyPrefix);
    return null;
  }

  const identifier = await getSessionOrIp(req);
  const key = buildRateLimitKey(rawPathname, identifier, keyPrefix);
  const now = Date.now();
  const info = generalStore.map.get(key);

  if (!info || info.resetTime < now) {
    syncStoreEntry(generalStore, key, { count: 1, resetTime: now + windowMs }, now);
    return null;
  }

  if (info.count >= limit) {
    return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
  }

  info.count += 1;
  return null;
}

/**
 * @internal Override the PostgreSQL pool used by auth lockouts in tests.
 */
export function setAuthLockoutPoolForTesting(pool: Pool | null | undefined): void {
  testPoolOverride = pool;
}

/**
 * @internal Reset rate limits for testing purposes only.
 */
export function resetRateLimitsForTesting(): void {
  generalStore.map.clear();
  generalStore.earliestResetTime = Infinity;
  authStore.map.clear();
  authStore.earliestResetTime = Infinity;
  hasWarnedUntrustedProxyHeaders = false;
  lastDbPruneAt = 0;

  const activePool = resolveActivePgPool();
  if (activePool) {
    const previous = pendingResetPromise ?? Promise.resolve();
    const clearPromise = previous
      .then(async () => {
        await Promise.resolve(activePool.query('DELETE FROM "AuthLockout"')).catch(() => undefined);
      })
      .finally(() => {
        if (pendingResetPromise === clearPromise) {
          pendingResetPromise = null;
        }
      });
    pendingResetPromise = clearPromise;
  }
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
