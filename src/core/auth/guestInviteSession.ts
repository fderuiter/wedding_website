import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  buildHydratedGuestInvitation,
  getOrLoadGuestSession,
  setHydratedGuestInvitation,
} from '@/lib/requestContext';
import { normalizeSafeCallbackPath } from '@/utils/safeCallbackUrl';
import { isAdminRequest } from './auth.server';
import { isGuestRequest } from './guest.server';
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

interface InvitationLookupRecord extends Record<string, unknown> {
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
  payload: GuestInviteSessionPayload,
  req?: NextRequest
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

    const resolvedGuestName =
      typeof invite.guestName === 'string' && invite.guestName.trim()
        ? invite.guestName
        : payload.guestName;

    setHydratedGuestInvitation(
      buildHydratedGuestInvitation(invite, normalizedCode, resolvedGuestName),
      req
    );

    return {
      ...payload,
      code: payload.code,
      guestName: resolvedGuestName,
    };
  } catch {
    return null;
  }
}

function buildGuestSessionCacheKey(payload: GuestInviteSessionPayload): string {
  return `${payload.code}:${payload.guestName}:${payload.exp ?? ''}`;
}

const getCachedServerSignedGuestInviteSession = cache(() => getSignedGuestInviteSession());

async function resolveServerCookieGuestInviteSession(): Promise<GuestInviteSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  const signedPayload = await getCachedServerSignedGuestInviteSession();
  if (!signedPayload) {
    return null;
  }

  const cacheKey = buildGuestSessionCacheKey(signedPayload);
  return getOrLoadGuestSession(undefined, cacheKey, () =>
    resolveActiveInvitationSession(signedPayload)
  );
}

/**
 * Retrieve verified guest invitation session from NextRequest or cookieStore,
 * confirming that the session code still matches an active, non-sample InvitationCode record.
 */
export async function getGuestInviteSession(req?: NextRequest): Promise<GuestInviteSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  if (!req) {
    return resolveServerCookieGuestInviteSession();
  }

  const signedPayload = await getSignedGuestInviteSession(req);
  if (!signedPayload) {
    return null;
  }

  const cacheKey = buildGuestSessionCacheKey(signedPayload);
  return getOrLoadGuestSession(req, cacheKey, () =>
    resolveActiveInvitationSession(signedPayload, req)
  );
}

export function buildGuestLoginRedirectTarget(callbackPath: string | null): string {
  const safeCallbackPath = normalizeSafeCallbackPath(callbackPath);
  if (safeCallbackPath) {
    return `/guest/login?callbackUrl=${encodeURIComponent(safeCallbackPath)}`;
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

  const signedInvite = await getCachedServerSignedGuestInviteSession();
  if (!signedInvite) {
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
      callbackUrlHeader === '/guest/claim' ||
      callbackUrlHeader.startsWith('/guest/claim?') ||
      callbackUrlHeader === '/admin' ||
      callbackUrlHeader.startsWith('/admin/'))
  ) {
    return;
  }

  if ((await isAdminRequest()) || (await isGuestRequest())) {
    return;
  }

  const activeSession = await getGuestInviteSession();
  if (!activeSession) {
    redirectWithSeeOther(buildGuestLoginRedirectTarget(callbackUrlHeader));
  }
}
