import { NextRequest, NextResponse } from 'next/server';
import {
  GUEST_COOKIE,
  setGuestAuthCookie,
  signGuestToken,
  verifyGuestToken,
} from '@/core/auth/guest.server';
import {
  GUEST_INVITE_COOKIE,
  setGuestInviteSessionCookie,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import { findVerifiedRequestCookie } from '@/core/auth/tokenCookieHelpers';
import { hasAddressCollectionTag } from '@/features/registry';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { assertJsonContentType } from '@/utils/contentType';
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
  assertJsonContentType(req);

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
    let token: string | null = null;
    if (typeof findVerifiedRequestCookie === 'function' && typeof verifyGuestToken === 'function') {
      const verifiedExisting = await findVerifiedRequestCookie(
        GUEST_COOKIE,
        req,
        async (candidate) => {
          const payload = await verifyGuestToken(candidate);
          return payload && payload.guest === true ? payload : null;
        },
        { suppressErrors: true }
      );
      if (verifiedExisting) {
        token = verifiedExisting.token;
      }
    }

    if (!token) {
      const iat = Date.now();
      const exp = iat + 7 * 24 * 60 * 60 * 1000; // 7 days
      token = await signGuestToken({ guest: true, jti: crypto.randomUUID(), iat, exp });
    }

    const response = NextResponse.json({ success: true, sessionType: 'guest' });
    setGuestAuthCookie(response, token, req);
    return response;
  }

  let invite: {
    id?: string;
    code: string;
    guestName: string;
    isSample?: boolean;
    partyTags?: string[];
  } | null = null;
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

  if (invite && !invite.isSample && !hasAddressCollectionTag(invite.partyTags)) {
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

    let inviteToken: string | null = null;
    if (
      typeof findVerifiedRequestCookie === 'function' &&
      typeof verifyGuestInviteSessionToken === 'function'
    ) {
      const verifiedExistingInvite = await findVerifiedRequestCookie(
        GUEST_INVITE_COOKIE,
        req,
        async (candidate) => {
          const existingInvitePayload = await verifyGuestInviteSessionToken(candidate);
          if (
            existingInvitePayload &&
            existingInvitePayload.code.trim().toUpperCase() === invite.code.trim().toUpperCase() &&
            existingInvitePayload.guestName === invite.guestName
          ) {
            return existingInvitePayload;
          }
          return null;
        },
        { suppressErrors: true }
      );
      if (verifiedExistingInvite) {
        inviteToken = verifiedExistingInvite.token;
      }
    }

    if (!inviteToken) {
      const iat = Date.now();
      const exp = iat + 7 * 24 * 60 * 60 * 1000; // 7 days
      inviteToken = await signGuestInviteSessionToken({
        code: invite.code,
        guestName: invite.guestName,
        iat,
        exp,
      });
    }

    const response = NextResponse.json({
      success: true,
      sessionType: 'invitation',
      guestName: invite.guestName,
    });
    setGuestInviteSessionCookie(response, inviteToken, req);
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
