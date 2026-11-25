import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveTenantClaimsForSigning } from './tenantClaims.node';
import { isValidTokenEpochVersion } from './tokenEpochs';

interface AppConfigAdminVersionRecord {
  adminTokenVersion?: number | null;
}

interface AppConfigAdminVersionDelegate {
  findUnique?: (args: {
    where: { id: string };
    select: { adminTokenVersion: boolean };
  }) => Promise<AppConfigAdminVersionRecord | null>;
  findFirst?: (args: {
    select: { adminTokenVersion: boolean };
  }) => Promise<AppConfigAdminVersionRecord | null>;
  upsert?: (args: {
    where: { id: string };
    update: { adminTokenVersion: { increment: number } };
    create: { id: string; subdomain?: string; adminTokenVersion: number };
  }) => Promise<unknown>;
}

function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

function getAppConfigAdminVersionDelegate():
  | AppConfigAdminVersionDelegate
  | undefined {
  return (
    prisma as unknown as { appConfig?: AppConfigAdminVersionDelegate }
  )?.appConfig;
}

/**
 * Resolves the active `AppConfig.adminTokenVersion` for Node-runtime admin session verification.
 * Returns `1` on uninitialized/defaulted databases and `null` (fail-closed) when Prisma throws
 * or returns an invalid version value.
 */
export async function resolveActiveAdminTokenVersion(
  siteId?: string
): Promise<number | null> {
  if (isStaticExportBuild()) {
    return 1;
  }

  try {
    const delegate = getAppConfigAdminVersionDelegate();
    if (!delegate) {
      return 1;
    }

    const targetConfigId = siteId && siteId.trim() ? siteId.trim() : 'global';
    let record: AppConfigAdminVersionRecord | null | undefined;
    if (typeof delegate.findUnique === 'function') {
      record = await delegate.findUnique({
        where: { id: targetConfigId },
        select: { adminTokenVersion: true },
      });
    }
    if (record === undefined && typeof delegate.findFirst === 'function') {
      record = await delegate.findFirst({
        select: { adminTokenVersion: true },
      });
    }

    if (
      record === null ||
      record === undefined ||
      record.adminTokenVersion === undefined
    ) {
      return 1;
    }

    return isValidTokenEpochVersion(record.adminTokenVersion)
      ? record.adminTokenVersion
      : null;
  } catch {
    return null;
  }
}

/**
 * Atomically increments `AppConfig.adminTokenVersion` for the resolved request tenant,
 * immediately revoking all previously issued `admin_auth` cookies for that site.
 */
export async function incrementAdminTokenVersion(
  req?: NextRequest
): Promise<void> {
  const tenantClaims = await resolveTenantClaimsForSigning(req);
  const targetId = tenantClaims.siteId || 'global';
  const delegate = getAppConfigAdminVersionDelegate();

  if (typeof delegate?.upsert === 'function') {
    await delegate.upsert({
      where: { id: targetId },
      update: { adminTokenVersion: { increment: 1 } },
      create: {
        id: targetId,
        ...(tenantClaims.subdomain ? { subdomain: tenantClaims.subdomain } : {}),
        adminTokenVersion: 2,
      },
    });
  }
}
