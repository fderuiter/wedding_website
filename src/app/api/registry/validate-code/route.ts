import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { signGuestInviteSessionToken, GUEST_INVITE_COOKIE } from '@/core/auth/guestInviteSession';
import { resolveTenantClaimsForSigning } from '@/core/auth/tenantClaims.node';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code')?.trim().toUpperCase();

  if (!code) {
    throw new ApiError(400, 'Code is required.');
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code }
  });

  if (!invite || invite.isSample) {
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

  const tenantClaims = await resolveTenantClaimsForSigning(request);
  const token = await signGuestInviteSessionToken({
    code: invite.code,
    guestName: invite.guestName,
    ...tenantClaims,
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
