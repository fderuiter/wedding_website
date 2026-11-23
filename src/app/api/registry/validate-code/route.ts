import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { assertJsonContentType } from '@/utils/contentType';
import { ValidateInvitationCodeSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import {
  setGuestInviteSessionCookie,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import { hasAddressCollectionTag } from '@/features/registry';

async function findActiveInvitationCode(rawCode: string | undefined | null) {
  const code = rawCode?.trim().toUpperCase();
  if (!code) {
    throw new ApiError(400, 'Code is required.');
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code },
  });

  if (!invite || invite.isSample || hasAddressCollectionTag(invite.partyTags)) {
    throw new ApiError(404, 'Invalid invitation code.');
  }

  return invite;
}

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const invite = await findActiveInvitationCode(searchParams.get('code'));

  return NextResponse.json({
    valid: true,
    guestName: invite.guestName,
    code: invite.code,
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

  const invite = await findActiveInvitationCode(parsed.data.code);

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

  const token = await signGuestInviteSessionToken({
    code: invite.code,
    guestName: invite.guestName,
  });

  const response = NextResponse.json({
    valid: true,
    guestName: invite.guestName,
    code: invite.code,
  });

  setGuestInviteSessionCookie(response, token, request);
  return response;
});
