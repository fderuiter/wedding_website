import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { GuestLookupSchema } from '@/utils/validation';
import { signGuestToken, GUEST_COOKIE } from '@/core/auth/guest.server';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { env } from '@/env';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parseResult = GuestLookupSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { query, name, email } = parseResult.data;
  const searchEmail = email?.trim() || (query?.includes('@') ? query.trim() : undefined);
  const searchName = name?.trim() || (!query?.includes('@') ? query?.trim() : undefined);

  const conditions: Array<Record<string, { equals: string; mode: 'insensitive' }>> = [];
  if (searchEmail) {
    conditions.push({ email: { equals: searchEmail, mode: 'insensitive' } });
  }
  if (searchName) {
    conditions.push({ guestName: { equals: searchName, mode: 'insensitive' } });
  }

  let invite = await prisma.invitationCode.findFirst({
    where: conditions.length === 1 ? conditions[0] : { OR: conditions },
  });

  if (!invite && searchName && searchName.length >= 3) {
    invite = await prisma.invitationCode.findFirst({
      where: {
        guestName: { contains: searchName, mode: 'insensitive' },
      },
    });
  }

  if (!invite) {
    throw new ApiError(404, 'No invitation found matching the provided details.');
  }

  const iat = Date.now();
  const exp = iat + 7 * 24 * 60 * 60 * 1000; // 7 days

  const guestToken = await signGuestToken({ guest: true, iat, exp });
  const inviteToken = await signGuestInviteSessionToken({
    code: invite.code,
    guestName: invite.guestName,
    iat,
    exp,
  });

  const response = NextResponse.json({
    success: true,
    guestName: invite.guestName,
    code: invite.code,
    data: {
      guestName: invite.guestName,
      code: invite.code,
    },
  });

  response.cookies.set(GUEST_COOKIE, guestToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  response.cookies.set(GUEST_INVITE_COOKIE, inviteToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
});
