import { NextRequest, NextResponse } from 'next/server';

interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const rateLimits = new Map<string, RateLimitInfo>();

/**
 * Enforces a per-client request limit within a fixed time window.
 *
 * @param limit - Maximum number of requests allowed during the window
 * @param windowMs - Duration of the rate-limit window in milliseconds
 * @returns A 429 response when the client exceeds the limit, or `null` when the request is allowed
 */
export async function rateLimit(req: NextRequest, limit: number, windowMs: number): Promise<NextResponse | null> {
  // Try to get IP from x-forwarded-for header, fallback to '127.0.0.1'
  // In Next.js App Router, 'req.ip' is often undefined or requires proxy setup
  const ip = req.headers.get('x-forwarded-for') || '127.0.0.1';

  const now = Date.now();
  const info = rateLimits.get(ip);

  if (!info || info.resetTime < now) {
    rateLimits.set(ip, { count: 1, resetTime: now + windowMs });
    return null;
  }

  if (info.count >= limit) {
    return NextResponse.json({ error: 'Too many requests, please try again later.' }, { status: 429 });
  }

  info.count += 1;
  return null;
}

