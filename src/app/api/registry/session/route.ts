import { NextResponse, NextRequest } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
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
    });

    if (existingCookie) {
      response.cookies.set(GUEST_INVITE_COOKIE, '', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 0,
      });
    }

    return response;
  }

  return NextResponse.json({
    isVerified: true,
    invitationCode: session.code,
    code: session.code,
    guestName: session.guestName,
  });
});

export const DELETE = withApiMiddleware(async () => {
  const response = NextResponse.json({
    isVerified: false,
    invitationCode: null,
    code: null,
    guestName: null,
  });

  response.cookies.set(GUEST_INVITE_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });

  return response;
});
