export interface RateLimitInfo {
  count: number;
  resetTime: number;
}

const limits = new Map<string, RateLimitInfo>();

export function checkRateLimit(ip: string, limit: number, windowMs: number): boolean {
  const now = Date.now();

  // Lazy cleanup to avoid memory leaks if Map gets too large
  if (limits.size > 10000) {
    for (const [key, info] of limits.entries()) {
      if (now > info.resetTime) {
        limits.delete(key);
      }
    }
  }

  const info = limits.get(ip);

  if (!info || now > info.resetTime) {
    limits.set(ip, { count: 1, resetTime: now + windowMs });
    return true;
  }

  if (info.count >= limit) {
    return false;
  }

  info.count += 1;
  return true;
}

// Added this to be able to reset the state for tests
export function resetRateLimitsForTesting() {
  limits.clear();
}
