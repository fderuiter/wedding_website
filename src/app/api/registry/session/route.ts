import { NextResponse, NextRequest } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);

  if (!session) {
    return NextResponse.json({
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
    });
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
