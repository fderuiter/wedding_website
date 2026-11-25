import { NextResponse, NextRequest } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  clearGuestInviteSessionCookie,
  extractOptionalInvitePostalFields,
  getGuestInviteSession,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const existingCookie = await readRequestCookie(GUEST_INVITE_COOKIE, request, {
    suppressErrors: true,
  });
  const session = await getGuestInviteSession(request);

  if (!session) {
    const response = NextResponse.json({
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      email: null,
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
    ...extractOptionalInvitePostalFields(session),
  });
});

export const DELETE = withApiMiddleware(async (request: NextRequest) => {
  const response = NextResponse.json({
    isVerified: false,
    invitationCode: null,
    code: null,
    guestName: null,
    email: null,
  });

  clearGuestInviteSessionCookie(response, request);

  return response;
});
