import crypto from 'node:crypto';
import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { ApiError } from '@/utils/ApiError';
import { MAX_PASSWORD_LENGTH } from '@/utils/password';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
  GUEST_INVITE_COOKIE,
} from '@/core/auth/guestInviteSession';
import {
  resolveTenantClaimsForSigning,
  verifyNodeTenantClaims,
} from '@/core/auth/tenantClaims.node';
import { readRequestCookie } from '@/core/auth/tokenCookieHelpers';
import { hasAddressCollectionTag } from '@/features/registry';

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

  if (rawCode.length > MAX_PASSWORD_LENGTH || code.length > MAX_PASSWORD_LENGTH) {
    throw new ApiError(400, `Code must be at most ${MAX_PASSWORD_LENGTH} characters.`);
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code },
  });

  if (!invite || invite.isSample || hasAddressCollectionTag(invite.partyTags)) {
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
        existingPayload.guestName === invite.guestName &&
        (await verifyNodeTenantClaims(existingPayload, request))
      ) {
        token = existingToken;
      }
    }
  }

  if (!token) {
    const tenantClaims = await resolveTenantClaimsForSigning(request);
    token = await signGuestInviteSessionToken({
      code: invite.code,
      guestName: invite.guestName,
      ...tenantClaims,
    });
  }

  const resolvedEmail =
    typeof invite.email === 'string' && invite.email.trim().length > 0
      ? invite.email.trim()
      : null;

  const response = NextResponse.json({
    valid: true,
    guestName: invite.guestName,
    code: invite.code,
    email: resolvedEmail,
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
