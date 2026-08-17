import { NextResponse, NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code')?.trim().toUpperCase();

  if (!code) {
    throw new ApiError(400, 'Code is required.');
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code }
  });

  if (!invite) {
    throw new ApiError(404, 'Invalid invitation code.');
  }

  if (invite.used) {
    throw new ApiError(400, 'This invitation code has already been used.');
  }

  return NextResponse.json({
    valid: true,
    guestName: invite.guestName,
    code: invite.code,
  });
});
