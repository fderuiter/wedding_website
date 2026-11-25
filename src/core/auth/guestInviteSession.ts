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
  clearGuestInviteSessionCookie,
  extractOptionalInvitePostalFields,
  getSignedGuestInviteSession,
  setGuestInviteSessionCookie,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from './guestInviteToken';
import {
  GUEST_PHOTO_COOKIE,
  type PhotoUploadSessionPayload,
  isPhotoScopedPagePath,
  verifyPhotoUploadSessionToken,
} from './photoUploadToken';
import {
  resolveEdgeRequestSubdomain,
  verifyEdgeTenantClaims,
} from './tenantClaims';
import { verifyNodeTenantClaims } from './tenantClaims.node';
import { readRequestCookieCandidates } from './tokenCookieHelpers';

export {
  GUEST_INVITE_COOKIE,
  type GuestInviteSessionPayload,
  clearGuestInviteSessionCookie,
  extractOptionalInvitePostalFields,
  setGuestInviteSessionCookie,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
};

interface InvitationLookupRecord extends Record<string, unknown> {
  code?: string;
  guestName?: string;
  email?: string | null;
  isSample?: boolean;
  partyTags?: unknown;
}

function hasUnpromotedAddressCollectionTag(partyTags: unknown): boolean {
  if (!Array.isArray(partyTags)) return false;
  return partyTags.some(
    (tag) => typeof tag === 'string' && tag.trim().toLowerCase() === 'address-collection'
  );
}

interface InvitationCodeLookupDelegate {
  findUnique?: (args: {
    where: { code: string; isSample: boolean };
  }) => Promise<InvitationLookupRecord | null | undefined>;
  findFirst?: (args: {
    where: { code: { equals: string; mode: 'insensitive' }; isSample: boolean };
  }) => Promise<InvitationLookupRecord | null | undefined>;
}

interface AppConfigTokenVersionRecord {
  guestPhotoQrTokenVersion?: number | null;
}

interface AppConfigTokenVersionLookupDelegate {
  findUnique?: (args: {
    where: { id: string };
    select: { guestPhotoQrTokenVersion: boolean };
  }) => Promise<AppConfigTokenVersionRecord | null | undefined>;
  findFirst?: (args: {
    select: { guestPhotoQrTokenVersion: boolean };
  }) => Promise<AppConfigTokenVersionRecord | null | undefined>;
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

    if (!invite || invite.isSample === true || hasUnpromotedAddressCollectionTag(invite.partyTags)) {
      return null;
    }

    const resolvedGuestName =
      typeof invite.guestName === 'string' && invite.guestName.trim()
        ? invite.guestName
        : payload.guestName;
    const resolvedEmail =
      typeof invite.email === 'string' && invite.email.trim()
        ? invite.email.trim()
        : null;

    setHydratedGuestInvitation(
      buildHydratedGuestInvitation(invite, normalizedCode, resolvedGuestName),
      req
    );

    return {
      ...payload,
      code: payload.code,
      guestName: resolvedGuestName,
      email: resolvedEmail,
      ...extractOptionalInvitePostalFields(invite),
    };
  } catch {
    return null;
  }
}

function buildGuestSessionCacheKey(payload: GuestInviteSessionPayload): string {
  return `${payload.code}:${payload.guestName}:${payload.siteId ?? ''}:${payload.subdomain ?? ''}:${payload.exp ?? ''}`;
}

const getCachedVerifiedInviteToken = cache((cookieValue: string) =>
  verifyGuestInviteSessionToken(cookieValue)
);
const getCachedVerifiedPhotoUploadSession = cache((cookieValue: string) =>
  verifyPhotoUploadSessionToken(cookieValue)
);

async function resolveServerSignedPhotoUploadSession(): Promise<PhotoUploadSessionPayload | null> {
  const candidates = await readRequestCookieCandidates(GUEST_PHOTO_COOKIE, undefined, {
    suppressErrors: true,
  });
  for (const cookieValue of candidates) {
    const payload = await getCachedVerifiedPhotoUploadSession(cookieValue);
    if (payload && payload.exp >= Date.now()) {
      return payload;
    }
  }
  return null;
}

const getCachedServerRawVerifiedInviteToken = cache(async () => {
  const candidates = await readRequestCookieCandidates(GUEST_INVITE_COOKIE, undefined, {
    suppressErrors: true,
  });
  for (const cookieValue of candidates) {
    const payload = await getCachedVerifiedInviteToken(cookieValue);
    if (payload && (!payload.exp || payload.exp >= Date.now())) {
      return payload;
    }
  }
  return null;
});

async function resolveServerCookieGuestInviteSession(): Promise<GuestInviteSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  const candidates = await readRequestCookieCandidates(GUEST_INVITE_COOKIE, undefined, {
    suppressErrors: true,
  });
  if (candidates.length === 0) {
    return null;
  }

  let resolvedSubdomain: string | null | undefined;
  for (const cookieValue of candidates) {
    const signedPayload = await getCachedVerifiedInviteToken(cookieValue);
    if (!signedPayload || (signedPayload.exp && signedPayload.exp < Date.now())) {
      continue;
    }

    if (resolvedSubdomain === undefined) {
      resolvedSubdomain = await resolveEdgeRequestSubdomain();
    }
    if (!verifyEdgeTenantClaims(signedPayload, resolvedSubdomain)) {
      continue;
    }

    if (!(await verifyNodeTenantClaims(signedPayload))) {
      continue;
    }

    const cacheKey = buildGuestSessionCacheKey(signedPayload);
    const active = await getOrLoadGuestSession(undefined, cacheKey, () =>
      resolveActiveInvitationSession(signedPayload)
    );
    if (active) {
      return active;
    }
  }

  return null;
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

  const candidates = await readRequestCookieCandidates(GUEST_INVITE_COOKIE, req, {
    suppressErrors: true,
  });
  if (candidates.length === 0) {
    return null;
  }

  const firstSigned =
    candidates.length === 1 ? await getSignedGuestInviteSession(req) : null;
  if (candidates.length === 1) {
    if (!firstSigned) {
      return null;
    }
    if (!(await verifyNodeTenantClaims(firstSigned, req))) {
      return null;
    }
    const cacheKey = buildGuestSessionCacheKey(firstSigned);
    return getOrLoadGuestSession(req, cacheKey, () =>
      resolveActiveInvitationSession(firstSigned, req)
    );
  }

  let resolvedSubdomain: string | null | undefined;
  for (const cookieValue of candidates) {
    const signedPayload = await verifyGuestInviteSessionToken(cookieValue);
    if (!signedPayload || (signedPayload.exp && signedPayload.exp < Date.now())) {
      continue;
    }

    if (resolvedSubdomain === undefined) {
      resolvedSubdomain = await resolveEdgeRequestSubdomain(req);
    }
    if (!verifyEdgeTenantClaims(signedPayload, resolvedSubdomain)) {
      continue;
    }

    if (!(await verifyNodeTenantClaims(signedPayload, req))) {
      continue;
    }

    const cacheKey = buildGuestSessionCacheKey(signedPayload);
    const active = await getOrLoadGuestSession(req, cacheKey, () =>
      resolveActiveInvitationSession(signedPayload, req)
    );
    if (active) {
      return active;
    }
  }

  return null;
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

async function resolveActivePhotoTokenVersion(
  expectedVersion?: number,
  siteId?: string
): Promise<number> {
  if (
    typeof expectedVersion === 'number' &&
    Number.isInteger(expectedVersion) &&
    expectedVersion >= 1
  ) {
    return expectedVersion;
  }

  try {
    const delegate = (
      prisma as unknown as { appConfig?: AppConfigTokenVersionLookupDelegate }
    )?.appConfig;
    if (!delegate) {
      return 1;
    }

    const targetConfigId = siteId && siteId.trim() ? siteId.trim() : 'global';
    let record: AppConfigTokenVersionRecord | null | undefined;
    if (typeof delegate.findUnique === 'function') {
      record = await delegate.findUnique({
        where: { id: targetConfigId },
        select: { guestPhotoQrTokenVersion: true },
      });
    }
    if (record === undefined && typeof delegate.findFirst === 'function') {
      record = await delegate.findFirst({
        select: { guestPhotoQrTokenVersion: true },
      });
    }

    const version = record?.guestPhotoQrTokenVersion;
    if (typeof version === 'number' && Number.isInteger(version) && version >= 1) {
      return version;
    }
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Retrieves and verifies the active photo-scoped session cookie against tenant claims
 * (when `MULTISITE_ENABLED` is active) and the current database QR token rotation version.
 * Returns null when missing, expired, cross-tenant, or rotated.
 */
export async function getActivePhotoUploadSession(
  req?: NextRequest,
  expectedVersion?: number
): Promise<PhotoUploadSessionPayload | null> {
  if (isStaticExportBuild()) {
    return null;
  }

  const candidates = await readRequestCookieCandidates(GUEST_PHOTO_COOKIE, req, {
    suppressErrors: true,
  });
  if (candidates.length === 0) {
    return null;
  }

  let resolvedSubdomain: string | null | undefined;
  for (const cookieValue of candidates) {
    const signedPayload = req
      ? await verifyPhotoUploadSessionToken(cookieValue)
      : await getCachedVerifiedPhotoUploadSession(cookieValue);
    if (!signedPayload || signedPayload.exp < Date.now()) {
      continue;
    }

    if (resolvedSubdomain === undefined) {
      resolvedSubdomain = await resolveEdgeRequestSubdomain(req);
    }
    if (!verifyEdgeTenantClaims(signedPayload, resolvedSubdomain)) {
      continue;
    }

    if (!(await verifyNodeTenantClaims(signedPayload, req))) {
      continue;
    }

    const activeVersion = await resolveActivePhotoTokenVersion(
      expectedVersion,
      signedPayload.siteId
    );
    if (signedPayload.v !== activeVersion) {
      continue;
    }

    return signedPayload;
  }

  return null;
}

/**
 * Server-side rendering guard for guest-gated pages and layouts.
 * Requires a valid HMAC stamp on internal `x-guest-gated-page` and `x-guest-callback-url`
 * headers before skipping database revocation verification or trusting `callbackUrl`.
 * Redirects callers holding a revoked, rotated, sample, or cross-tenant `guest_invite_session`
 * cookie or a rotated/out-of-scope `guest_photo_session` cookie (without a valid `guest_auth`
 * or `admin_auth` cookie) to `/guest/login` with HTTP 303.
 */
export async function enforceActiveGuestPageSession(): Promise<void> {
  if (isStaticExportBuild()) {
    return;
  }

  const rawVerifiedInvite = await getCachedServerRawVerifiedInviteToken();
  const signedPhoto = await resolveServerSignedPhotoUploadSession();
  if (!rawVerifiedInvite && !signedPhoto) {
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

  const rawCallbackPath = verifiedCallbackUrl ? verifiedCallbackUrl.split('?')[0] : null;
  const normalizedCallbackPath =
    rawCallbackPath && rawCallbackPath.length > 1
      ? rawCallbackPath.replace(/\/+$/, '') || '/'
      : rawCallbackPath;

  if (
    normalizedCallbackPath === '/guest' &&
    !verifiedCallbackUrl?.includes('code=') &&
    signedPhoto &&
    !rawVerifiedInvite
  ) {
    if ((await isAdminRequest()) || (await isGuestRequest())) {
      return;
    }
    redirectWithSeeOther(buildGuestLoginRedirectTarget(verifiedCallbackUrl));
    return;
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

  if (rawVerifiedInvite) {
    const activeSession = await getGuestInviteSession();
    if (activeSession) {
      return;
    }
  }

  if (
    normalizedCallbackPath &&
    isPhotoScopedPagePath(normalizedCallbackPath) &&
    signedPhoto
  ) {
    const activePhotoSession = await getActivePhotoUploadSession();
    if (activePhotoSession) {
      return;
    }
  }

  redirectWithSeeOther(buildGuestLoginRedirectTarget(verifiedCallbackUrl));
}
