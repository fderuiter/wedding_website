import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { env } from '@/env';
import {
  normalizeTenantSubdomain,
  resolveRequestSubdomain,
} from '@/utils/hostValidation';

export interface TenantTokenClaims {
  siteId?: string;
  subdomain?: string | null;
}

export function isMultisiteAuthEnabled(): boolean {
  return Boolean(env.MULTISITE_ENABLED);
}

export async function resolveEdgeRequestSubdomain(req?: NextRequest): Promise<string | null> {
  if (req) {
    return resolveRequestSubdomain(req.headers, req.nextUrl?.host);
  }

  try {
    if (typeof headers === 'function') {
      const headerStore = await headers();
      if (headerStore && typeof headerStore.get === 'function') {
        return resolveRequestSubdomain(headerStore);
      }
    }
  } catch {
    // Request headers may be unavailable outside request render scope
  }

  return null;
}

/**
 * Validates tenant claims at the Edge (without database access) when `MULTISITE_ENABLED` is active.
 * Rejects tokens with missing `siteId`, missing `subdomain`, or a `subdomain` claim that does not
 * match the normalized incoming request subdomain.
 */
export function verifyEdgeTenantClaims(
  payload: TenantTokenClaims,
  requestSubdomain: string | null
): boolean {
  if (!isMultisiteAuthEnabled()) {
    return true;
  }

  if (typeof payload.siteId !== 'string' || !payload.siteId.trim()) {
    return false;
  }

  if (
    !('subdomain' in payload) ||
    payload.subdomain === undefined ||
    (payload.subdomain !== null && typeof payload.subdomain !== 'string')
  ) {
    return false;
  }

  return normalizeTenantSubdomain(payload.subdomain) === requestSubdomain;
}
