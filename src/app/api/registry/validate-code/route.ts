import crypto from 'node:crypto';
import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { ApiError } from '@/utils/ApiError';
import { assertJsonContentType } from '@/utils/contentType';
import { MAX_PASSWORD_LENGTH } from '@/utils/password';
import { ValidateInvitationCodeSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  GUEST_INVITE_COOKIE,
  setGuestInviteSessionCookie,
  signGuestInviteSessionToken,
  verifyGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import {
  resolveTenantClaimsForSigning,
  verifyNodeTenantClaims,
} from '@/core/auth/tenantClaims.node';
import { findVerifiedRequestCookie } from '@/core/auth/tokenCookieHelpers';
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

type InvitationLookupResult =
  | {
    kind: 'invite';
    invite: NonNullable<Awaited<ReturnType<typeof prisma.invitationCode.findUnique>>>;
  }
  | {
    kind: 'shared_passcode';
    error: string;
  };

async function findActiveInvitationCode(
  rawCodeInput: string | undefined | null
): Promise<InvitationLookupResult> {
  const rawCode = rawCodeInput?.trim() || '';
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
      return {
        kind: 'shared_passcode',
        error:
          'That is the shared website passcode. Please enter the personal household invitation code printed on your invitation.',
      };
    }

    throw new ApiError(404, 'Invalid invitation code.');
  }

  return { kind: 'invite', invite };
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const lookup = await findActiveInvitationCode(searchParams.get('code'));

  if (lookup.kind === 'shared_passcode') {
    return NextResponse.json({
      valid: false,
      reason: 'shared_passcode',
      error: lookup.error,
    });
  }

  const { invite } = lookup;
  const resolvedEmail =
    typeof invite.email === 'string' && invite.email.trim().length > 0
      ? invite.email.trim()
      : null;

  return NextResponse.json({
    valid: true,
    guestName: invite.guestName,
    code: invite.code,
    email: resolvedEmail,
  });
});

export const POST = withApiMiddleware(async (request: NextRequest) => {
  assertJsonContentType(request);

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parsed = ValidateInvitationCodeSchema.safeParse(rawBody);
  if (!parsed.success) {
    throw new ApiError(400, parsed.error.issues[0]?.message || 'Code is required.');
  }

  const lookup = await findActiveInvitationCode(parsed.data.code);
  if (lookup.kind === 'shared_passcode') {
    return NextResponse.json({
      valid: false,
      reason: 'shared_passcode',
      error: lookup.error,
    });
  }

  const { invite } = lookup;

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
    typeof findVerifiedRequestCookie === 'function' &&
    typeof verifyGuestInviteSessionToken === 'function'
  ) {
    const verifiedExisting = await findVerifiedRequestCookie(
      GUEST_INVITE_COOKIE,
      request,
      async (candidate) => {
        const existingPayload = await verifyGuestInviteSessionToken(candidate);
        if (
          existingPayload &&
          existingPayload.code.trim().toUpperCase() === invite.code.trim().toUpperCase() &&
          existingPayload.guestName === invite.guestName &&
          (await verifyNodeTenantClaims(existingPayload, request))
        ) {
          return existingPayload;
        }
        return null;
      },
      { suppressErrors: true }
    );
    if (verifiedExisting) {
      token = verifiedExisting.token;
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

  setGuestInviteSessionCookie(response, token, request);
  return response;
});
