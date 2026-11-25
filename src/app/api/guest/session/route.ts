import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  clearGuestInviteSessionCookie,
  getGuestInviteSession,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import { GUEST_PHOTO_COOKIE } from '@/core/auth/photoUploadToken';
import { GUEST_COOKIE, isGuestRequest } from '@/core/auth/guest.server';
import { clearSessionCookie, readRequestCookie } from '@/core/auth/tokenCookieHelpers';

type GuestPortalSessionStatus = 'invitation' | 'passcode' | 'none';

const PRIVATE_SESSION_HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Cookie',
} as const;

function isStaticExportBuild(): boolean {
  return (
    process.env.STATIC_EXPORT === 'true' ||
    process.env.STATIC_EXPORT === '1' ||
    process.env.npm_lifecycle_event === 'build:export'
  );
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  if (isStaticExportBuild()) {
    return NextResponse.json(
      {
        status: 'none' as GuestPortalSessionStatus,
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        hasPasscodeSession: false,
      },
      { headers: PRIVATE_SESSION_HEADERS }
    );
  }

  const existingInviteCookie = await readRequestCookie(GUEST_INVITE_COOKIE, request, {
    suppressErrors: true,
  });

  const [inviteSession, hasPasscodeSession] = await Promise.all([
    getGuestInviteSession(request),
    isGuestRequest(request),
  ]);

  if (inviteSession) {
    return NextResponse.json(
      {
        status: 'invitation' as GuestPortalSessionStatus,
        isVerified: true,
        invitationCode: inviteSession.code,
        code: inviteSession.code,
        guestName: inviteSession.guestName,
        hasPasscodeSession,
      },
      { headers: PRIVATE_SESSION_HEADERS }
    );
  }

  const status: GuestPortalSessionStatus = hasPasscodeSession ? 'passcode' : 'none';
  const response = NextResponse.json(
    {
      status,
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession,
    },
    { headers: PRIVATE_SESSION_HEADERS }
  );

  if (existingInviteCookie) {
    clearGuestInviteSessionCookie(response, request);
  }

  return response;
});

function resolveDeleteScope(request: NextRequest): string | null {
  const fromNextUrl = request.nextUrl?.searchParams?.get('scope');
  if (typeof fromNextUrl === 'string') {
    return fromNextUrl;
  }
  try {
    return new URL(request.url, 'http://localhost').searchParams.get('scope');
  } catch {
    return null;
  }
}

export const DELETE = withApiMiddleware(async (request: NextRequest) => {
  const clearAll = resolveDeleteScope(request) === 'all';
  const hasPasscodeSession =
    clearAll || isStaticExportBuild() ? false : await isGuestRequest(request);
  const status: GuestPortalSessionStatus = hasPasscodeSession ? 'passcode' : 'none';

  const response = NextResponse.json(
    {
      status,
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession,
    },
    { headers: PRIVATE_SESSION_HEADERS }
  );

  clearGuestInviteSessionCookie(response, request);
  if (clearAll) {
    clearSessionCookie(response, GUEST_COOKIE || 'guest_auth', request);
    clearSessionCookie(response, GUEST_PHOTO_COOKIE || 'guest_photo_session', request);
  }

  return response;
});
