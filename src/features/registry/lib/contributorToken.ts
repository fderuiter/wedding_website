import { env } from '@/env';
import type { TenantTokenClaims } from '@/core/auth/tenantClaims';
import { signCompactToken, verifyCompactToken } from '@/core/auth/tokenCookieHelpers';
import { normalizeTenantSubdomain } from '@/utils/hostValidation';

type ContributorActionScope = 'confirm' | 'cancel';

interface ContributorActionTokenPayload extends TenantTokenClaims {
  contributorId: string;
  action: ContributorActionScope;
  iat: number;
  exp: number;
}

const DEFAULT_CONTRIBUTOR_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function getContributorTokenSecret(): Promise<string> {
  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  const fallback = isProduction ? '' : 'default-guest-session-secret';
  const secret = isProduction
    ? (process.env.GUEST_SESSION_SECRET || fallback)
    : (process.env.GUEST_SESSION_SECRET || env.GUEST_SESSION_SECRET || fallback);
  const passcode = isProduction
    ? (process.env.GUEST_PASSCODE || 'wedding2026')
    : (process.env.GUEST_PASSCODE || env.GUEST_PASSCODE || 'wedding2026');

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

/**
 * Signs a contributor action token scoping contributorId, action ('confirm' | 'cancel'),
 * optional tenant claims (siteId, subdomain), and expiration.
 */
export async function signContributorActionToken(input: {
  contributorId: string;
  action: ContributorActionScope;
  siteId?: string;
  subdomain?: string | null;
  iat?: number;
  exp?: number;
}): Promise<string> {
  const iat = input.iat ?? Date.now();
  const exp = input.exp ?? iat + DEFAULT_CONTRIBUTOR_TOKEN_TTL_MS;
  const payload: ContributorActionTokenPayload = {
    contributorId: input.contributorId,
    action: input.action,
    ...(typeof input.siteId === 'string' && input.siteId.trim().length > 0
      ? { siteId: input.siteId.trim() }
      : {}),
    ...('subdomain' in input && input.subdomain !== undefined
      ? { subdomain: normalizeTenantSubdomain(input.subdomain) }
      : {}),
    iat,
    exp,
  };
  const secret = await getContributorTokenSecret();
  return signCompactToken(payload, secret);
}

/**
 * Verifies a compact HMAC-SHA256 contributor action token, checking signature, scope, and expiration.
 */
export async function verifyContributorActionToken(
  token: string,
  expectedAction?: ContributorActionScope
): Promise<ContributorActionTokenPayload | null> {
  if (!token || typeof token !== 'string') {
    return null;
  }

  try {
    const secret = await getContributorTokenSecret();
    const payload = await verifyCompactToken<ContributorActionTokenPayload>(token, secret);
    if (
      !payload ||
      typeof payload.contributorId !== 'string' ||
      payload.contributorId.trim().length === 0 ||
      (payload.action !== 'confirm' && payload.action !== 'cancel') ||
      typeof payload.exp !== 'number'
    ) {
      return null;
    }

    if (payload.siteId !== undefined && typeof payload.siteId !== 'string') {
      return null;
    }

    if (
      payload.subdomain !== undefined &&
      payload.subdomain !== null &&
      typeof payload.subdomain !== 'string'
    ) {
      return null;
    }

    if (payload.exp < Date.now()) {
      return null;
    }

    if (expectedAction && payload.action !== expectedAction) {
      return null;
    }

    return {
      contributorId: payload.contributorId,
      action: payload.action,
      ...(typeof payload.siteId === 'string' && payload.siteId.trim().length > 0
        ? { siteId: payload.siteId.trim() }
        : {}),
      ...(payload.subdomain !== undefined
        ? { subdomain: normalizeTenantSubdomain(payload.subdomain) }
        : {}),
      iat: payload.iat,
      exp: payload.exp,
    };
  } catch {
    return null;
  }
}
