import { NextResponse, NextRequest } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  clearGuestInviteSessionCookie,
  getGuestInviteSession,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import { isGuestRequest } from '@/core/auth/guest.server';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const existingCookie = await readRequestCookie(GUEST_INVITE_COOKIE, request, {
    suppressErrors: true,
  });
  const [session, hasPasscodeSession] = await Promise.all([
    getGuestInviteSession(request),
    isGuestRequest(request),
  ]);

  if (!session) {
    const response = NextResponse.json({
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      email: null,
      ...(hasPasscodeSession ? { hasPasscodeSession: true } : {}),
    });

    if (existingCookie) {
      clearGuestInviteSessionCookie(response, request);
    }

    return response;
  }

  return NextResponse.json({
    isVerified: true,
    invitationCode: session.code,
    code: session.code,
    guestName: session.guestName,
    email: session.email ?? null,
    ...(hasPasscodeSession ? { hasPasscodeSession: true } : {}),
  });
});

export const DELETE = withApiMiddleware(async (request: NextRequest) => {
  const hasPasscodeSession = await isGuestRequest(request);
  const response = NextResponse.json({
    isVerified: false,
    invitationCode: null,
    code: null,
    guestName: null,
    email: null,
    ...(hasPasscodeSession ? { hasPasscodeSession: true } : {}),
  });

  clearGuestInviteSessionCookie(response, request);

  return response;
});
