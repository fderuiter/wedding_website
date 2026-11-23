import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { MAX_PASSWORD_LENGTH } from '@/utils/password';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';
import { hasAddressCollectionTag } from '@/features/registry';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code')?.trim().toUpperCase();

  if (!code) {
    throw new ApiError(400, 'Code is required.');
  }

  if (code.length > MAX_PASSWORD_LENGTH) {
    throw new ApiError(400, `Code must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code }
  });

  if (!invite || invite.isSample || hasAddressCollectionTag(invite.partyTags)) {
    throw new ApiError(404, 'Invalid invitation code.');
  }

  if (invite.id && typeof prisma.broadcastRecipient?.updateMany === 'function') {
    await prisma.broadcastRecipient.updateMany({
      where: {
        invitationCodeId: invite.id,
        status: 'SENT',
      },
      data: {
        status: 'VIEWED',
      },
    });
  }

  let token: string | null = null;
  if (
    typeof readRequestCookie === 'function' &&
    typeof verifyGuestInviteSessionToken === 'function'
  ) {
    const existingToken = await readRequestCookie(GUEST_INVITE_COOKIE, request, {
      suppressErrors: true,
    });
    if (existingToken) {
      const existingPayload = await verifyGuestInviteSessionToken(existingToken);
      if (
        existingPayload &&
        existingPayload.code.trim().toUpperCase() === invite.code.trim().toUpperCase() &&
        existingPayload.guestName === invite.guestName
      ) {
        token = existingToken;
      }
    }
  }

  if (!token) {
    token = await signGuestInviteSessionToken({
      code: invite.code,
      guestName: invite.guestName,
    });
  }

  const response = NextResponse.json({
    valid: true,
    guestName: invite.guestName,
    code: invite.code,
  });

  response.cookies.set(GUEST_INVITE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
});
