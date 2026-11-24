import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { NextRequest, NextResponse } from 'next/server';
import type { Pool, QueryResultRow } from 'pg';
import { verifyAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';
import { verifyGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import {
  getSignedGuestInviteSession,
  verifyGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteToken';
import { env } from '@/env';
import { logger } from '@/lib/logger';
import * as prismaModule from '@/lib/prisma';
import { normalizeSocketIp, readVerifiedSocketIp } from '@/lib/socket-ip-boundary.js';

interface RateLimitInfo {
  count: number;
  resetTime: number;
  limit?: number;
}

interface RateLimitStore {
  map: Map<string, RateLimitInfo>;
  unblockedKeys: Set<string>;
  earliestResetTime: number;
}

export type RateLimitScope = 'session' | 'ip';

interface RateLimitBehaviorOptions {
  increment?: boolean;
  scope?: RateLimitScope;
  ipLimit?: number;
}

export type RateLimitBucket = 'general' | 'auth';

export const MAX_RATE_LIMIT_KEYS = 10000;
const DEFAULT_AUTH_LOCKOUT_LIMIT = 5;
const GENERAL_IP_CEILING_MULTIPLIER = 5;
const MIN_GENERAL_IP_CEILING = 20;
const MAX_AUTH_WAITERS_PER_IP = 10;
const AUTH_LOCKOUT_QUERY_TIMEOUT_MS = 1000;
const DB_PRUNE_INTERVAL_MS = 60 * 1000;

const generalStore: RateLimitStore = {
  map: new Map<string, RateLimitInfo>(),
  unblockedKeys: new Set<string>(),
  earliestResetTime: Infinity,
};

const authStore: RateLimitStore = {
  map: new Map<string, RateLimitInfo>(),
  unblockedKeys: new Set<string>(),
  earliestResetTime: Infinity,
};

interface AuthIpLockState {
  active: boolean;
  waiters: Array<() => void>;
}

const authIpLocks = new Map<string, AuthIpLockState>();

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
  '/api/admin/geocode',
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
  '/api/admin/photos/qr',
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

function isIpScopedGeneralRoute(
  pathname: string,
  method: string = 'GET',
  keyPrefix?: string
): boolean {
  if (isAuthLockoutRoute(pathname, method)) {
    return true;
  }
  if (
    keyPrefix === 'public_address_collect' ||
    keyPrefix === 'registry-claim-preview' ||
    keyPrefix === 'registry-claim-mutate'
  ) {
    return true;
  }
  const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;
  const upperMethod = method.toUpperCase();
  return (
    normalized === '/api/guest/address/public' ||
    normalized === '/api/registry/claim' ||
    (normalized === '/api/admin/setup' && upperMethod === 'GET') ||
    normalized === '/api/registry/webhook/stripe' ||
    normalized === '/api/ready'
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
  if (/^\/api\/admin\/photos\/(?!(?:moderation|qr)$)[^/]+$/.test(cleaned)) {
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

function isActivelyBlockedEntry(info: RateLimitInfo, now: number): boolean {
  return info.resetTime >= now && info.limit !== undefined && info.count >= info.limit;
}

function deleteStoreEntry(store: RateLimitStore, key: string): void {
  store.map.delete(key);
  store.unblockedKeys.delete(key);
}

function touchStoreEntry(
  store: RateLimitStore,
  key: string,
  info: RateLimitInfo,
  now: number
): void {
  store.map.delete(key);
  store.map.set(key, info);
  store.unblockedKeys.delete(key);
  if (!isActivelyBlockedEntry(info, now)) {
    store.unblockedKeys.add(key);
  }
  if (info.resetTime < store.earliestResetTime) {
    store.earliestResetTime = info.resetTime;
  }
}

function getActiveStoreEntry(
  store: RateLimitStore,
  key: string,
  now: number
): RateLimitInfo | undefined {
  const existing = store.map.get(key);
  if (!existing) {
    return undefined;
  }
  if (existing.resetTime < now) {
    deleteStoreEntry(store, key);
    return undefined;
  }
  return existing;
}

function pruneExpiredEntries(store: RateLimitStore, now: number): void {
  if (now < store.earliestResetTime) return;
  let newEarliest = Infinity;
  for (const [k, v] of store.map.entries()) {
    if (v.resetTime < now) {
      deleteStoreEntry(store, k);
    } else if (v.resetTime < newEarliest) {
      newEarliest = v.resetTime;
    }
  }
  store.earliestResetTime = store.map.size === 0 ? Infinity : newEarliest;
}

function ensureStoreCapacityForKey(store: RateLimitStore, key: string, now: number): void {
  pruneExpiredEntries(store, now);
  if (store.map.has(key)) {
    return;
  }
  while (store.map.size >= MAX_RATE_LIMIT_KEYS) {
    let evicted = false;
    while (store.unblockedKeys.size > 0) {
      const oldestUnblockedKey = store.unblockedKeys.values().next().value;
      if (oldestUnblockedKey === undefined) {
        break;
      }
      store.unblockedKeys.delete(oldestUnblockedKey);
      const candidate = store.map.get(oldestUnblockedKey);
      if (!candidate) {
        continue;
      }
      if (isActivelyBlockedEntry(candidate, now)) {
        continue;
      }
      store.map.delete(oldestUnblockedKey);
      evicted = true;
      break;
    }
    if (!evicted) {
      const oldestKey = store.map.keys().next().value;
      if (oldestKey !== undefined) {
        deleteStoreEntry(store, oldestKey);
      } else {
        break;
      }
    }
  }
}

function syncStoreEntry(store: RateLimitStore, key: string, info: RateLimitInfo, now: number): void {
  ensureStoreCapacityForKey(store, key, now);
  touchStoreEntry(store, key, info, now);
}

function incrementStoreEntry(
  store: RateLimitStore,
  key: string,
  windowMs: number,
  now: number,
  limit: number = DEFAULT_AUTH_LOCKOUT_LIMIT
): RateLimitInfo {
  const existing = getActiveStoreEntry(store, key, now);
  if (!existing) {
    const nextInfo: RateLimitInfo = { count: 1, resetTime: now + windowMs, limit };
    syncStoreEntry(store, key, nextInfo, now);
    return nextInfo;
  }
  existing.count += 1;
  if (existing.limit === undefined || limit < existing.limit) {
    existing.limit = limit;
  }
  touchStoreEntry(store, key, existing, now);
  return existing;
}

function isStoreEntryLockedOut(
  store: RateLimitStore,
  key: string,
  limit: number,
  now: number
): boolean {
  const existing = getActiveStoreEntry(store, key, now);
  if (!existing) return false;
  existing.limit = limit;
  touchStoreEntry(store, key, existing, now);
  return existing.count >= limit;
}

/**
 * Sanitizes a single forwarded IP token by trimming quotes/whitespace, stripping
 * port suffixes on IPv4 (`1.2.3.4:54321`) and bracketed IPv6 (`[2001:db8::1]:8443`),
 * canonicalizing IPv4-mapped IPv6 addresses, stripping IPv6 zone identifiers, and
 * validating via `node:net` `isIP`.
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
    const normalizedBracketed = normalizeSocketIp(bracketedMatch[1]);
    if (normalizedBracketed) {
      return normalizedBracketed;
    }
    const ipv6Candidate = bracketedMatch[1].split('%')[0];
    return isIP(ipv6Candidate) === 6 ? ipv6Candidate.toLowerCase() : null;
  }

  const normalizedDirect = normalizeSocketIp(token);
  if (normalizedDirect) {
    return normalizedDirect;
  }

  const withoutZone = token.includes('%') ? token.split('%')[0] : token;
  const ipv4WithPortMatch = withoutZone.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
  if (ipv4WithPortMatch && isIP(ipv4WithPortMatch[1]) === 4) {
    return ipv4WithPortMatch[1];
  }

  return null;
}

export function getClientIp(req: NextRequest): string {
  if (req && typeof req === 'object' && 'ip' in req) {
    try {
      delete (req as { ip?: string }).ip;
    } catch {
      // Ignore non-configurable property descriptors
    }
  }

  const trustProxy = env.TRUST_PROXY;
  const hasHeaderReader = typeof req.headers?.get === 'function';

  // 1. When TRUST_PROXY is disabled, never trust X-Forwarded-For or X-Real-IP;
  //    read only the HMAC-verified internal socket IP stamped at the HTTP boundary.
  if (!trustProxy) {
    const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
    if (isProduction && !hasWarnedUntrustedProxyHeaders && hasHeaderReader) {
      const hasForwardedFor = Boolean(req.headers.get('x-forwarded-for')?.trim());
      const hasRealIp = Boolean(req.headers.get('x-real-ip')?.trim());
      if (hasForwardedFor || hasRealIp) {
        hasWarnedUntrustedProxyHeaders = true;
        logger.warn(
          'Forwarded IP headers detected while TRUST_PROXY is disabled; rate limiting is ignoring forwarded headers. Configure TRUST_PROXY to match your reverse-proxy hop count.',
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
    return (hasHeaderReader ? readVerifiedSocketIp(req.headers) : null) ?? '127.0.0.1';
  }

  const hops = typeof trustProxy === 'number' ? Math.max(1, Math.trunc(trustProxy)) : 1;

  // 2. Evaluate trusted hop in x-forwarded-for header from reverse proxy
  const rawForwarded = hasHeaderReader ? req.headers.get('x-forwarded-for') : null;
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

  // 3. Fallback: x-real-ip when x-forwarded-for is missing and proxy trust is enabled
  const realIp = hasHeaderReader ? req.headers.get('x-real-ip') : null;
  if (realIp) {
    const sanitizedRealIp = sanitizeIpToken(realIp);
    if (sanitizedRealIp) {
      return sanitizedRealIp;
    }
  }

  // 4. Fall back to verified socket IP or loopback IP when no valid forwarded address exists
  return (hasHeaderReader ? readVerifiedSocketIp(req.headers) : null) ?? '127.0.0.1';
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

async function resolveSessionPrincipal(req: NextRequest): Promise<string | null> {
  const adminCookieName = ADMIN_COOKIE || 'admin_auth';
  const adminCookie = extractRequestCookie(req, adminCookieName);
  if (adminCookie) {
    try {
      if (typeof verifyAdminToken === 'function') {
        const payload = await verifyAdminToken(adminCookie);
        if (payload && payload.isAdmin === true) {
          return 'session:admin';
        }
      }
    } catch {
      // Malformed or invalid admin cookie falls through
    }
  }

  const inviteCookieName = GUEST_INVITE_COOKIE || 'guest_invite_session';
  const inviteCookie = extractRequestCookie(req, inviteCookieName);
  if (inviteCookie) {
    try {
      const payload =
        typeof getSignedGuestInviteSession === 'function'
          ? await getSignedGuestInviteSession(req)
          : typeof verifyGuestInviteSessionToken === 'function'
            ? await verifyGuestInviteSessionToken(inviteCookie)
            : null;
      if (payload && typeof payload.code === 'string' && payload.code.trim() && payload.guestName) {
        return `session:invite:${payload.code.trim().toUpperCase()}`;
      }
    } catch {
      // Malformed or invalid guest invite cookie falls through
    }
  }

  const guestCookieName = GUEST_COOKIE || 'guest_auth';
  const guestCookie = extractRequestCookie(req, guestCookieName);
  if (guestCookie) {
    try {
      if (typeof verifyGuestToken === 'function') {
        const payload = await verifyGuestToken(guestCookie);
        if (payload && payload.guest === true) {
          const tokenId =
            typeof payload.jti === 'string' && payload.jti.trim().length > 0
              ? payload.jti.trim()
              : crypto.createHash('sha256').update(guestCookie).digest('hex');
          return `session:guest:${tokenId}`;
        }
      }
    } catch {
      // Malformed or invalid guest cookie falls through
    }
  }

  return null;
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
    ? (env.GUEST_SESSION_SECRET || process.env.GUEST_SESSION_SECRET || '')
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
  if (isMockedFunction(prismaModule.prisma?.$disconnect)) {
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
    _keyPrefix?: string,
    _limit?: number
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
    unblockedKeys: new Set<string>(),
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
          syncStoreEntry(localStore, rawKey, { count: dbCount, resetTime: dbResetTime, limit }, now);
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
    keyPrefix?: string,
    limit: number = DEFAULT_AUTH_LOCKOUT_LIMIT
  ): Promise<void> => {
    const clientIp = getClientIp(req);
    const rawPathname = extractRawPathname(req);
    const rawKey = buildRateLimitKey(rawPathname, clientIp, keyPrefix);
    const now = Date.now();
    const resetTime = now + windowMs;
    const effectiveLimit = localStore.map.get(rawKey)?.limit ?? limit;
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
        syncStoreEntry(
          localStore,
          rawKey,
          { count: dbCount, resetTime: dbResetTime, limit: effectiveLimit },
          now
        );
        return;
      }
      // PostgreSQL query timed out or errored: fall back to local in-memory store
    }

    incrementStoreEntry(localStore, rawKey, windowMs, now, effectiveLimit);
  };

  return {
    checkLockout,
    recordFailure,
    getLocalStoreSize: () => localStore.map.size,
  };
}

const defaultAuthLockoutInstance = createAuthLockoutInstance({ store: authStore });

export async function acquireAuthIpLock(
  req: NextRequest,
  maxQueued: number = MAX_AUTH_WAITERS_PER_IP
): Promise<(() => void) | null> {
  const ipKey = getClientIp(req);
  let state = authIpLocks.get(ipKey);

  if (!state) {
    if (authIpLocks.size >= MAX_RATE_LIMIT_KEYS) {
      return null;
    }
    state = { active: true, waiters: [] };
    authIpLocks.set(ipKey, state);
    const createdState = state;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = authIpLocks.get(ipKey);
      if (!current || current !== createdState) return;
      const next = current.waiters.shift();
      if (next) {
        next();
      } else {
        current.active = false;
        authIpLocks.delete(ipKey);
      }
    };
  }

  if (!state.active) {
    state.active = true;
  } else {
    if (state.waiters.length >= maxQueued) {
      return null;
    }
    const pendingState = state;
    await new Promise<void>((resolve) => {
      pendingState.waiters.push(resolve);
    });
  }

  const acquiredState = state;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = authIpLocks.get(ipKey);
    if (!current || current !== acquiredState) return;
    const next = current.waiters.shift();
    if (next) {
      next();
    } else {
      current.active = false;
      authIpLocks.delete(ipKey);
    }
  };
}

export async function checkAuthLockout(
  req: NextRequest,
  limit: number = DEFAULT_AUTH_LOCKOUT_LIMIT,
  windowMs: number = 15 * 60 * 1000,
  keyPrefix?: string,
  instance: AuthLockoutInstance = defaultAuthLockoutInstance
): Promise<NextResponse | null> {
  return instance.checkLockout(req, limit, windowMs, keyPrefix);
}

export async function recordAuthFailure(
  req: NextRequest,
  windowMs: number = 15 * 60 * 1000,
  keyPrefix?: string,
  instance: AuthLockoutInstance = defaultAuthLockoutInstance,
  limit: number = DEFAULT_AUTH_LOCKOUT_LIMIT
): Promise<void> {
  return instance.recordFailure(req, windowMs, keyPrefix, limit);
}

export async function recordFailedAuthAttempt(
  req: NextRequest,
  limit: number = DEFAULT_AUTH_LOCKOUT_LIMIT,
  windowMs: number = 15 * 60 * 1000,
  keyPrefix?: string,
  instance: AuthLockoutInstance = defaultAuthLockoutInstance
): Promise<void> {
  return instance.recordFailure(req, windowMs, keyPrefix, limit);
}

export async function rateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number,
  keyPrefix?: string,
  bucket?: RateLimitBucket,
  behavior?: RateLimitBehaviorOptions
): Promise<NextResponse | null> {
  const rawPathname = extractRawPathname(req);
  const method = req.method || 'GET';
  const isLockoutEndpoint = isAuthLockoutRoute(rawPathname, method);
  const resolvedBucket: RateLimitBucket =
    bucket ?? (isLockoutEndpoint ? 'auth' : 'general');
  const shouldIncrement = behavior?.increment !== false;

  if (resolvedBucket === 'auth') {
    const blocked = await checkAuthLockout(req, limit, windowMs, keyPrefix);
    if (blocked) {
      return blocked;
    }
    if (shouldIncrement) {
      await recordAuthFailure(req, windowMs, keyPrefix, undefined, limit);
    }
    return null;
  }

  const forceIpScope =
    behavior?.scope === 'ip' || isIpScopedGeneralRoute(rawPathname, method, keyPrefix);
  const clientIp = getClientIp(req);
  const sessionPrincipal = forceIpScope ? null : await resolveSessionPrincipal(req);
  const now = Date.now();
  pruneExpiredEntries(generalStore, now);

  if (!sessionPrincipal) {
    const ipKey = buildRateLimitKey(rawPathname, clientIp, keyPrefix);
    const info = getActiveStoreEntry(generalStore, ipKey, now);

    if (!info) {
      if (!shouldIncrement) {
        return null;
      }
      syncStoreEntry(generalStore, ipKey, { count: 1, resetTime: now + windowMs, limit }, now);
      return null;
    }

    info.limit = limit;
    if (info.count >= limit) {
      touchStoreEntry(generalStore, ipKey, info, now);
      return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
    }

    if (shouldIncrement) {
      info.count += 1;
    }
    touchStoreEntry(generalStore, ipKey, info, now);
    return null;
  }

  const ipLimit =
    behavior?.ipLimit ?? Math.max(limit * GENERAL_IP_CEILING_MULTIPLIER, MIN_GENERAL_IP_CEILING);
  const sessionKey = buildRateLimitKey(rawPathname, sessionPrincipal, keyPrefix);
  const ipCeilingKey = buildRateLimitKey(rawPathname, `ip-ceiling:${clientIp}`, keyPrefix);

  const ipInfo = getActiveStoreEntry(generalStore, ipCeilingKey, now);
  if (ipInfo) {
    ipInfo.limit = ipLimit;
    if (ipInfo.count >= ipLimit) {
      touchStoreEntry(generalStore, ipCeilingKey, ipInfo, now);
      return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
    }
  }

  const sessionInfo = getActiveStoreEntry(generalStore, sessionKey, now);
  if (sessionInfo) {
    sessionInfo.limit = limit;
    if (sessionInfo.count >= limit) {
      touchStoreEntry(generalStore, sessionKey, sessionInfo, now);
      return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
    }
  }

  if (!shouldIncrement) {
    if (ipInfo) {
      touchStoreEntry(generalStore, ipCeilingKey, ipInfo, now);
    }
    if (sessionInfo) {
      touchStoreEntry(generalStore, sessionKey, sessionInfo, now);
    }
    return null;
  }

  if (sessionInfo) {
    sessionInfo.count += 1;
    touchStoreEntry(generalStore, sessionKey, sessionInfo, now);
  } else {
    syncStoreEntry(generalStore, sessionKey, { count: 1, resetTime: now + windowMs, limit }, now);
  }

  if (ipInfo) {
    ipInfo.count += 1;
    touchStoreEntry(generalStore, ipCeilingKey, ipInfo, now);
  } else {
    syncStoreEntry(
      generalStore,
      ipCeilingKey,
      { count: 1, resetTime: now + windowMs, limit: ipLimit },
      now
    );
  }

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
  generalStore.unblockedKeys.clear();
  generalStore.earliestResetTime = Infinity;
  authStore.map.clear();
  authStore.unblockedKeys.clear();
  authStore.earliestResetTime = Infinity;
  for (const state of authIpLocks.values()) {
    while (state.waiters.length > 0) {
      const waiter = state.waiters.shift();
      waiter?.();
    }
    state.active = false;
  }
  authIpLocks.clear();
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
