import { NextRequest, NextResponse } from 'next/server';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
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
  const body = await req.json();
  const parseResult = GuestLoginSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json({ success: false, error: parseResult.error.issues[0].message }, { status: 400 });
  }

  const { passcode } = parseResult.data;

  const expectedPasscode = env.GUEST_PASSCODE;

  if (!expectedPasscode || !safeComparePasscode(passcode, expectedPasscode)) {
    return NextResponse.json({ success: false, error: 'Incorrect passcode.' }, { status: 401 });
  }

  const iat = Date.now();
  const exp = iat + 7 * 24 * 60 * 60 * 1000; // 7 days
  const token = await signGuestToken({ guest: true, iat, exp });

  const response = NextResponse.json({ success: true });
  response.cookies.set(GUEST_COOKIE, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60, // 7 days
  });
  return response;
});
