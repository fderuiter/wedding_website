import { NextRequest, NextResponse } from 'next/server';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { GuestLoginSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import crypto from 'node:crypto';

function safeComparePasscode(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const hashA = crypto.createHash('sha256').update(a).digest();
  const hashB = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body.' }, { status: 400 });
  }

  const parseResult = GuestLoginSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
  }

  const { passcode } = parseResult.data;
  const trimmedCode = passcode.trim();

  const isProduction = (process.env.NODE_ENV || env.NODE_ENV) === 'production';
  const expectedPasscode = isProduction
    ? (process.env.GUEST_PASSCODE ?? '')
    : env.GUEST_PASSCODE;

  if (isProduction && (!expectedPasscode.trim() || expectedPasscode.trim() === 'wedding2026')) {
    return NextResponse.json(
      { success: false, error: 'Guest passcode is not configured for production.' },
      { status: 503 }
    );
  }

  const matchesSharedPasscode =
    Boolean(expectedPasscode) &&
    (safeComparePasscode(passcode, expectedPasscode) ||
      (trimmedCode.length > 0 && trimmedCode !== passcode && safeComparePasscode(trimmedCode, expectedPasscode)));

  if (matchesSharedPasscode) {
    const iat = Date.now();
    const exp = iat + 7 * 24 * 60 * 60 * 1000; // 7 days
    const token = await signGuestToken({ guest: true, iat, exp });

    const response = NextResponse.json({ success: true, sessionType: 'guest' });
    response.cookies.set(GUEST_COOKIE, token, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
    return response;
  }

  let invite: { id?: string; code: string; guestName: string; isSample?: boolean } | null = null;
  if (trimmedCode.length > 0) {
    if (typeof prisma.invitationCode?.findFirst === 'function') {
      invite = await prisma.invitationCode.findFirst({
        where: {
          code: { equals: trimmedCode, mode: 'insensitive' },
          isSample: false,
        },
      });
    } else if (typeof prisma.invitationCode?.findUnique === 'function') {
      invite = await prisma.invitationCode.findUnique({
        where: { code: trimmedCode.toUpperCase(), isSample: false },
      });
    }
  }

  if (invite && !invite.isSample) {
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

    const iat = Date.now();
    const exp = iat + 7 * 24 * 60 * 60 * 1000; // 7 days
    const inviteToken = await signGuestInviteSessionToken({
      code: invite.code,
      guestName: invite.guestName,
      iat,
      exp,
    });

    const response = NextResponse.json({
      success: true,
      sessionType: 'invitation',
      guestName: invite.guestName,
    });
    response.cookies.set(GUEST_INVITE_COOKIE, inviteToken, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });
    return response;
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Incorrect passcode or invitation code. Need help? Open the help drawer below for assistance.',
      helpPrompt: 'Need help finding your code? Open the help drawer below for instructions on how to reach the hosts.',
    },
    { status: 401 }
  );
});
