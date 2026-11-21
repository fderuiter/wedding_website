import type { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import * as authServer from './auth.server';
import * as guestServer from './guest.server';

interface SessionGuardConfigSnapshot {
  guestPasscodeEnabled: boolean;
  guestPasscodeVersion: number;
  adminSessionVersion: number;
  adminPasswordHash: string | null;
  guestPasscode: string | null;
}

export async function loadSessionGuardConfig(): Promise<SessionGuardConfigSnapshot> {
  if (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  ) {
    return {
      guestPasscodeEnabled: false,
      guestPasscodeVersion: 1,
      adminSessionVersion: 1,
      adminPasswordHash: null,
      guestPasscode: null,
    };
  }

  try {
    if (typeof prisma?.appConfig?.findUnique !== 'function') {
      return {
        guestPasscodeEnabled: true,
        guestPasscodeVersion: 1,
        adminSessionVersion: 1,
        adminPasswordHash: null,
        guestPasscode: null,
      };
    }

    const config = await prisma.appConfig.findUnique({
      where: { id: 'global' },
      select: {
        guestPasscodeEnabled: true,
        guestPasscodeVersion: true,
        adminSessionVersion: true,
        adminPasswordHash: true,
        guestPasscode: true,
      },
    });

    return {
      guestPasscodeEnabled:
        typeof config?.guestPasscodeEnabled === 'boolean' ? config.guestPasscodeEnabled : true,
      guestPasscodeVersion:
        typeof config?.guestPasscodeVersion === 'number' ? config.guestPasscodeVersion : 1,
      adminSessionVersion:
        typeof config?.adminSessionVersion === 'number' ? config.adminSessionVersion : 1,
      adminPasswordHash:
        typeof config?.adminPasswordHash === 'string' && config.adminPasswordHash.trim().length > 0
          ? config.adminPasswordHash.trim()
          : null,
      guestPasscode:
        typeof config?.guestPasscode === 'string' && config.guestPasscode.trim().length > 0
          ? config.guestPasscode.trim()
          : null,
    };
  } catch {
    return {
      guestPasscodeEnabled: true,
      guestPasscodeVersion: 1,
      adminSessionVersion: 1,
      adminPasswordHash: null,
      guestPasscode: null,
    };
  }
}

export function resolveActiveAdminPasswordHash(
  config?: { adminPasswordHash?: string | null } | null
): string {
  if (config?.adminPasswordHash && config.adminPasswordHash.trim().length > 0) {
    return config.adminPasswordHash.trim();
  }
  return env.ADMIN_PASSWORD;
}

/**
 * Verifies admin authentication including database-backed `adminSessionVersion` check in Node.
 * Remains compatible with unit tests that mock `isAdminRequest` directly.
 */
export async function isActiveAdminSession(
  req?: NextRequest,
  expectedSessionVersion?: number
): Promise<boolean> {
  if (typeof authServer.getVerifiedAdminPayload !== 'function') {
    return authServer.isAdminRequest(req);
  }

  const payload = await authServer.getVerifiedAdminPayload(req);
  if (!payload) {
    return false;
  }

  const versionToEnforce =
    typeof expectedSessionVersion === 'number'
      ? expectedSessionVersion
      : (await loadSessionGuardConfig()).adminSessionVersion;

  return (payload.adminSessionVersion ?? 1) === versionToEnforce;
}

/**
 * Verifies shared guest passcode cookie authentication including database-backed
 * `guestPasscodeVersion` check in Node.
 */
export async function isActiveGuestPasscodeSession(
  req?: NextRequest,
  expectedPasscodeVersion?: number
): Promise<boolean> {
  if (typeof guestServer.getVerifiedGuestPayload !== 'function') {
    return guestServer.isGuestRequest(req);
  }

  const payload = await guestServer.getVerifiedGuestPayload(req);
  if (!payload) {
    return false;
  }

  const versionToEnforce =
    typeof expectedPasscodeVersion === 'number'
      ? expectedPasscodeVersion
      : (await loadSessionGuardConfig()).guestPasscodeVersion;

  return (payload.guestPasscodeVersion ?? 1) === versionToEnforce;
}
