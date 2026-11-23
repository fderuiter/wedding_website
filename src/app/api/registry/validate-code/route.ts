import crypto from 'node:crypto';
import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';

function safeComparePasscode(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  const maxLen = Math.max(bufA.length, bufB.length, 1);
  const paddedA = Buffer.alloc(maxLen);
  const paddedB = Buffer.alloc(maxLen);
  bufA.copy(paddedA);
  bufB.copy(paddedB);
  const bytesEqual = crypto.timingSafeEqual(paddedA, paddedB);
  return bytesEqual && bufA.length === bufB.length;
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const rawCode = searchParams.get('code')?.trim() || '';
  const code = rawCode.toUpperCase();

  if (!code) {
    throw new ApiError(400, 'Code is required.');
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code },
  });

  if (!invite || invite.isSample) {
    const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
    const expectedPasscode = (
      isProduction ? (process.env.GUEST_PASSCODE ?? '') : (process.env.GUEST_PASSCODE ?? env.GUEST_PASSCODE ?? '')
    ).trim();

    if (
      expectedPasscode &&
      (safeComparePasscode(rawCode, expectedPasscode) ||
        safeComparePasscode(code, expectedPasscode.toUpperCase()))
    ) {
      return NextResponse.json({
        valid: false,
        reason: 'shared_passcode',
        error:
          'That is the shared website passcode. Please enter the personal household invitation code printed on your invitation.',
      });
    }

    throw new ApiError(404, 'Invalid invitation code.');
  }

  const token = await signGuestInviteSessionToken({
    code: invite.code,
    guestName: invite.guestName,
  });

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
