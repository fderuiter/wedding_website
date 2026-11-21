import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getVerifiedGuestPayload } from './guest.server';
import {
  isActiveAdminSession,
  isActiveGuestPasscodeSession,
  loadSessionGuardConfig,
} from './nodeSessionGuards';
import {
  GUEST_INVITE_COOKIE,
  type GuestInviteSessionPayload,
  getSignedGuestInviteSession,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from './guestInviteToken';

export {
  GUEST_INVITE_COOKIE,
  type GuestInviteSessionPayload,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
};

interface InvitationLookupRecord {
  code?: string;
  guestName?: string;
  isSample?: boolean;
}

interface InvitationCodeLookupDelegate {
  findUnique?: (args: {
    where: { code: string; isSample: boolean };
  }) => Promise<InvitationLookupRecord | null | undefined>;
  findFirst?: (args: {
    where: { code: { equals: string; mode: 'insensitive' }; isSample: boolean };
  }) => Promise<InvitationLookupRecord | null | undefined>;
}

function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

async function resolveActiveInvitationSession(
  payload: GuestInviteSessionPayload
): Promise<GuestInviteSessionPayload | null> {
  const normalizedCode = payload.code.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  try {
    const delegate = (prisma as unknown as { invitationCode?: InvitationCodeLookupDelegate })?.invitationCode;
    if (!delegate) {
      return null;
    }

    let invite: InvitationLookupRecord | null | undefined;
    if (typeof delegate.findUnique === 'function') {
      invite = await delegate.findUnique({
        where: {
          code: normalizedCode,
          isSample: false,
        },
      });
    }

    if (invite === undefined && typeof delegate.findFirst === 'function') {
      invite = await delegate.findFirst({
        where: {
          code: { equals: normalizedCode, mode: 'insensitive' },
          isSample: false,
        },
      });
    }

    if (!invite || invite.isSample === true) {
      return null;
    }

    return {
      ...payload,
      code: payload.code,
      guestName:
        typeof invite.guestName === 'string' && invite.guestName.trim()
          ? invite.guestName
          : payload.guestName,
    };
  } catch {
    return null;
  }
}

async function resolveServerCookieGuestInviteSession(): Promise<GuestInviteSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  const signedPayload = await getSignedGuestInviteSession();
  if (!signedPayload) {
    return null;
  }

  return resolveActiveInvitationSession(signedPayload);
}

const getCachedServerCookieGuestInviteSession = cache(resolveServerCookieGuestInviteSession);

/**
 * Retrieve verified guest invitation session from NextRequest or cookieStore,
 * confirming that the session code still matches an active, non-sample InvitationCode record.
 */
export async function getGuestInviteSession(req?: NextRequest): Promise<GuestInviteSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  if (!req) {
    return getCachedServerCookieGuestInviteSession();
  }

  const signedPayload = await getSignedGuestInviteSession(req);
  if (!signedPayload) {
    return null;
  }

  return resolveActiveInvitationSession(signedPayload);
}

export function buildGuestLoginRedirectTarget(callbackPath: string | null): string {
  if (
    callbackPath &&
    callbackPath.startsWith('/') &&
    !callbackPath.startsWith('//') &&
    callbackPath !== '/guest/login' &&
    !callbackPath.startsWith('/guest/login?')
  ) {
    const queryIdx = callbackPath.indexOf('?');
    if (queryIdx === -1) {
      return `/guest/login?callbackUrl=${encodeURIComponent(callbackPath)}`;
    }

    const pathnamePart = callbackPath.slice(0, queryIdx);
    const searchPart = callbackPath.slice(queryIdx + 1);
    const incomingParams = new URLSearchParams(searchPart);
    const incomingCode = incomingParams.get('code')?.trim();
    if (incomingParams.has('code')) {
      incomingParams.delete('code');
    }
    const cleanSearch = incomingParams.toString();
    const cleanCallback = cleanSearch ? `${pathnamePart}?${cleanSearch}` : pathnamePart;

    const redirectParams = new URLSearchParams();
    redirectParams.set('callbackUrl', cleanCallback);
    if (incomingCode) {
      redirectParams.set('code', incomingCode);
    }
    return `/guest/login?${redirectParams.toString()}`;
  }

  return '/guest/login';
}

function redirectWithSeeOther(url: string): void {
  try {
    redirect(url);
  } catch (err: unknown) {
    if (
      err &&
      typeof err === 'object' &&
      'digest' in err &&
      typeof (err as { digest?: unknown }).digest === 'string' &&
      (err as { digest: string }).digest.startsWith('NEXT_REDIRECT;')
    ) {
      (err as { digest: string }).digest = (err as { digest: string }).digest.replace(/;30[78];$/, ';303;');
    }
    throw err;
  }
}

/**
 * Server-side rendering guard for guest-gated pages and layouts.
 * Redirects callers holding a revoked, rotated, or sample guest_invite_session cookie
 * (without a valid guest_auth or admin_auth cookie) to /guest/login with HTTP 303.
 */
export async function enforceActiveGuestPageSession(): Promise<void> {
  if (isStaticExportBuild()) {
    return;
  }

  let isGuestGatedPage: string | null = null;
  let callbackUrlHeader: string | null = null;
  try {
    if (typeof headers === 'function') {
      const headerStore = await headers();
      if (headerStore && typeof headerStore.get === 'function') {
        isGuestGatedPage = headerStore.get('x-guest-gated-page');
        callbackUrlHeader = headerStore.get('x-guest-callback-url');
      }
    }
  } catch {
    // Request headers may be unavailable in isolated unit test renders
  }

  if (isGuestGatedPage === '0') {
    return;
  }

  if (
    callbackUrlHeader &&
    (callbackUrlHeader === '/guest' ||
      callbackUrlHeader.startsWith('/guest?') ||
      callbackUrlHeader === '/guest/login' ||
      callbackUrlHeader.startsWith('/guest/login?') ||
      callbackUrlHeader === '/guest/collect' ||
      callbackUrlHeader.startsWith('/guest/collect?') ||
      callbackUrlHeader === '/admin' ||
      callbackUrlHeader.startsWith('/admin/'))
  ) {
    return;
  }

  const guardConfig = await loadSessionGuardConfig();
  if (!guardConfig.guestPasscodeEnabled) {
    return;
  }

  const signedInvite = await getSignedGuestInviteSession();
  const guestPayload =
    typeof getVerifiedGuestPayload === 'function' ? await getVerifiedGuestPayload() : null;

  if (isGuestGatedPage !== '1' && !signedInvite && !guestPayload) {
    return;
  }

  if (
    (await isActiveAdminSession(undefined, guardConfig.adminSessionVersion)) ||
    (await isActiveGuestPasscodeSession(undefined, guardConfig.guestPasscodeVersion))
  ) {
    return;
  }

  const activeSession = await getGuestInviteSession();
  if (!activeSession) {
    redirectWithSeeOther(buildGuestLoginRedirectTarget(callbackUrlHeader));
  }
}
