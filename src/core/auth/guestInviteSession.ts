import { cache } from 'react';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import {
  buildHydratedGuestInvitation,
  getOrLoadGuestSession,
  setHydratedGuestInvitation,
} from '@/lib/requestContext';
import { normalizeSafeCallbackPath } from '@/utils/safeCallbackUrl';
import { isStaticExportBuild, redirectWithSeeOther } from './adminPageGuard';
import { isAdminRequest } from './auth.server';
import { isGuestRequest } from './guest.server';
import { verifyGuestInternalHeaders } from './guestHeaderSignature';
import {
  GUEST_INVITE_COOKIE,
  type GuestInviteSessionPayload,
  getSignedGuestInviteSession,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from './guestInviteToken';
import { verifyNodeTenantClaims } from './tenantClaims.node';
import { readRequestCookie } from './tokenCookieHelpers';

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

async function resolveActiveInvitationSession(
  payload: GuestInviteSessionPayload,
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
  const normalizedCode = payload.code.trim().toUpperCase();
  if (!normalizedCode) {
    return null;
  }

  try {
    const delegate = (prisma as unknown as { invitationCode?: InvitationCodeLookupDelegate })
      ?.invitationCode;
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
  return `${payload.code}:${payload.guestName}:${payload.siteId ?? ''}:${payload.subdomain ?? ''}:${payload.exp ?? ''}`;
}

const getCachedServerSignedGuestInviteSession = cache(() => getSignedGuestInviteSession());

const getCachedServerRawVerifiedInviteToken = cache(async () => {
  const cookieValue = await readRequestCookie(GUEST_INVITE_COOKIE, undefined, {
    suppressErrors: true,
  });
  if (!cookieValue) {
    return null;
  }
  return verifyGuestInviteSessionToken(cookieValue);
});

async function resolveServerCookieGuestInviteSession(): Promise<GuestInviteSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  const signedPayload = await getCachedServerSignedGuestInviteSession();
  if (!signedPayload) {
    return null;
  }

  if (!(await verifyNodeTenantClaims(signedPayload))) {
    return null;
  }

  const cacheKey = buildGuestSessionCacheKey(signedPayload);
  return getOrLoadGuestSession(undefined, cacheKey, () =>
    resolveActiveInvitationSession(signedPayload)
  );
}

/**
 * Retrieve verified guest invitation session from NextRequest or cookieStore,
 * confirming tenant claims (when `MULTISITE_ENABLED` is active) and verifying that
 * the session code still matches an active, non-sample InvitationCode record.
 */
export async function getGuestInviteSession(
  req?: NextRequest
): Promise<GuestInviteSessionPayload | null> {
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

  if (!(await verifyNodeTenantClaims(signedPayload, req))) {
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

function isExcludedGuestCallbackRoute(callbackUrl: string): boolean {
  return (
    callbackUrl === '/guest' ||
    callbackUrl.startsWith('/guest?') ||
    callbackUrl === '/guest/login' ||
    callbackUrl.startsWith('/guest/login?') ||
    callbackUrl === '/guest/collect' ||
    callbackUrl.startsWith('/guest/collect?') ||
    callbackUrl === '/guest/claim' ||
    callbackUrl.startsWith('/guest/claim?') ||
    callbackUrl === '/admin' ||
    callbackUrl.startsWith('/admin/')
  );
}

/**
 * Server-side rendering guard for guest-gated pages and layouts.
 * Requires a valid HMAC stamp on internal `x-guest-gated-page` and `x-guest-callback-url`
 * headers before skipping database revocation verification or trusting `callbackUrl`.
 * Redirects callers holding a revoked, rotated, sample, or cross-tenant `guest_invite_session`
 * cookie (without a valid `guest_auth` or `admin_auth` cookie) to `/guest/login` with HTTP 303.
 */
export async function enforceActiveGuestPageSession(): Promise<void> {
  if (isStaticExportBuild()) {
    return;
  }

  const rawVerifiedInvite = await getCachedServerRawVerifiedInviteToken();
  if (!rawVerifiedInvite) {
    return;
  }

  let verifiedGatedPage: '0' | '1' | null = null;
  let verifiedCallbackUrl: string | null = null;
  try {
    if (typeof headers === 'function') {
      const headerStore = await headers();
      if (headerStore && typeof headerStore.get === 'function') {
        const verifiedHeaders = await verifyGuestInternalHeaders(headerStore);
        if (verifiedHeaders.valid) {
          verifiedGatedPage = verifiedHeaders.gatedPage;
          verifiedCallbackUrl = verifiedHeaders.callbackUrl;
        }
      }
    }
  } catch {
    // Request headers may be unavailable in isolated unit test renders
  }

  if (verifiedGatedPage === '0') {
    return;
  }

  if (verifiedCallbackUrl && isExcludedGuestCallbackRoute(verifiedCallbackUrl)) {
    return;
  }

  if ((await isAdminRequest()) || (await isGuestRequest())) {
    return;
  }

  const activeSession = await getGuestInviteSession();
  if (!activeSession) {
    redirectWithSeeOther(buildGuestLoginRedirectTarget(verifiedCallbackUrl));
  }
}
