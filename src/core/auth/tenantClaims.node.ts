import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getAppConfig } from '@/lib/config';
import { getActiveContextRequest } from '@/lib/requestContext';
import {
  normalizeTenantSubdomain,
  resolveRequestSubdomain,
} from '@/utils/hostValidation';
import {
  isMultisiteAuthEnabled,
  type TenantTokenClaims,
  verifyEdgeTenantClaims,
} from './tenantClaims';

async function resolveNodeRequestSubdomain(req?: NextRequest): Promise<string | null> {
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
    const activeRequest = getActiveContextRequest();
    if (activeRequest?.headers) {
      return resolveRequestSubdomain(activeRequest.headers, activeRequest.nextUrl?.host);
    }
  }

  return null;
}

/**
 * Resolves `siteId` and normalized `subdomain` claims to stamp into newly minted session cookies.
 */
export async function resolveTenantClaimsForSigning(
  req?: NextRequest,
  explicitConfig?: { id?: string; subdomain?: string | null }
): Promise<{ siteId: string; subdomain: string | null }> {
  const requestSubdomain = await resolveNodeRequestSubdomain(req);

  if (explicitConfig?.id) {
    return {
      siteId: explicitConfig.id,
      subdomain: requestSubdomain ?? normalizeTenantSubdomain(explicitConfig.subdomain),
    };
  }

  if (!isMultisiteAuthEnabled()) {
    return {
      siteId: 'global',
      subdomain: requestSubdomain,
    };
  }

  const config = await getAppConfig(requestSubdomain ?? 'global');
  return {
    siteId: config.id || 'global',
    subdomain: requestSubdomain ?? normalizeTenantSubdomain(config.subdomain),
  };
}

/**
 * Verifies both `siteId` and normalized `subdomain` claims against the active `AppConfig`
 * tenant in Node API and SSR contexts when `MULTISITE_ENABLED` is active.
 */
export async function verifyNodeTenantClaims(
  payload: TenantTokenClaims,
  req?: NextRequest
): Promise<boolean> {
  if (!isMultisiteAuthEnabled()) {
    return true;
  }

  const requestSubdomain = await resolveNodeRequestSubdomain(req);
  if (!verifyEdgeTenantClaims(payload, requestSubdomain)) {
    return false;
  }

  const config = await getAppConfig(requestSubdomain ?? 'global');
  const expectedSiteId = config.id || 'global';
  const expectedSubdomain = requestSubdomain ?? normalizeTenantSubdomain(config.subdomain);

  return (
    payload.siteId === expectedSiteId &&
    normalizeTenantSubdomain(payload.subdomain) === expectedSubdomain
  );
}
