import { NextRequest, NextResponse } from 'next/server';
import { verifyAdminToken, ADMIN_COOKIE } from '@/core/auth/auth.server';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

export const MAX_RATE_LIMIT_KEYS = 10000;

const rateLimits = new Map<string, RateLimitInfo>();
let earliestResetTime = Infinity;

function pruneExpiredEntries(now: number): void {
  if (now < earliestResetTime) return;
  let newEarliest = Infinity;
  for (const [k, v] of rateLimits.entries()) {
    if (v.resetTime < now) {
      rateLimits.delete(k);
    } else {
      if (v.resetTime < newEarliest) {
        newEarliest = v.resetTime;
      }
    }
  }
  earliestResetTime = rateLimits.size === 0 ? Infinity : newEarliest;
}

function getClientIp(req: NextRequest): string {
  // 1. Prioritize req.ip from Next.js runtime when available
  const reqIp = (req as { ip?: string }).ip;
  if (reqIp) {
    return reqIp;
  }

  // 2. Evaluate rightmost x-forwarded-for entry from trusted reverse proxy
  const rawForwarded = req.headers.get('x-forwarded-for');
  if (rawForwarded) {
    const parts = rawForwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }

  // 3. Fallback: unverified x-real-ip (deprecated; only when x-forwarded-for is missing)
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }

  // 4. Fall back to loopback IP when no trusted address exists
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
  keyPrefix?: string
): Promise<NextResponse | null> {
  const identifier = await getSessionOrIp(req);

  let pathname = '';
  try {
    pathname = req.nextUrl?.pathname || (req.url ? new URL(req.url).pathname : '');
  } catch {
    pathname = '';
  }

  const key = keyPrefix ? `${keyPrefix}:${identifier}` : `${pathname}:${identifier}`;

  const now = Date.now();
  const info = rateLimits.get(key);

  if (!info || info.resetTime < now) {
    pruneExpiredEntries(now);
    if (!rateLimits.has(key)) {
      while (rateLimits.size >= MAX_RATE_LIMIT_KEYS) {
        const oldestKey = rateLimits.keys().next().value;
        if (oldestKey !== undefined) {
          rateLimits.delete(oldestKey);
        } else {
          break;
        }
      }
    }
    const resetTime = now + windowMs;
    rateLimits.set(key, { count: 1, resetTime });
    if (resetTime < earliestResetTime) {
      earliestResetTime = resetTime;
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
  rateLimits.clear();
  earliestResetTime = Infinity;
}

/**
 * @internal Get rate limits count for testing purposes only.
 */
export function getRateLimitsCountForTesting(): number {
  return rateLimits.size;
}

/**
 * @internal Get rate limits map for testing purposes only.
 */
export function getRateLimitsForTesting(): Map<string, RateLimitInfo> {
  return rateLimits;
}
