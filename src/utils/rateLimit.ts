import { NextRequest, NextResponse } from 'next/server';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const rateLimits = new Map<string, RateLimitInfo>();

function getClientIp(req: NextRequest): string {
  const reqIp = (req as { ip?: string }).ip;
  if (reqIp) {
    return reqIp;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  const rawForwarded = req.headers.get('x-forwarded-for');
  if (rawForwarded) {
    const parts = rawForwarded.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      return parts[parts.length - 1];
    }
  }
  return '127.0.0.1';
}

function getSessionOrIp(req: NextRequest): string {
  const adminCookie =
    req.cookies?.get?.('admin_auth')?.value ||
    (typeof req.headers?.get === 'function'
      ? req.headers.get('cookie')?.split(';').find((c) => c.trim().startsWith('admin_auth='))?.trim().slice('admin_auth='.length)
      : undefined);

  if (adminCookie) {
    return `session:${adminCookie}`;
  }
  return getClientIp(req);
}

export async function rateLimit(
  req: NextRequest,
  limit: number,
  windowMs: number,
  keyPrefix?: string
): Promise<NextResponse | null> {
  const identifier = getSessionOrIp(req);

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
    rateLimits.set(key, { count: 1, resetTime: now + windowMs });
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
}
