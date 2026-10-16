import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { GuestRsvpSchema, GuestRsvpDTO } from '@/features/registry/schemas';
import { formatZodError } from '@/utils/validation';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);
  if (!session) {
    throw new ApiError(401, 'Unauthorized guest session. Please validate your invitation code.');
  }

  const body = await request.json();
  const parseResult = GuestRsvpSchema.safeParse(body);

  if (!parseResult.success) {
    throw new ApiError(400, `Validation Error: ${formatZodError(parseResult.error)}`);
  }

  const data: GuestRsvpDTO = parseResult.data;
  const targetCode = data.code.trim().toUpperCase();

  if (session.code.trim().toUpperCase() !== targetCode) {
    throw new ApiError(403, 'Session invitation code does not match request body.');
  }

  const invite = await prisma.invitationCode.findUnique({
    where: { code: targetCode },
  });

  if (!invite) {
    throw new ApiError(404, 'Invitation code not found.');
  }

  const allowedPlusOnes = invite.plusOneAllocations ?? 0;
  const plusOneResponses = data.plusOneResponses || [];

  if (plusOneResponses.length > allowedPlusOnes) {
    throw new ApiError(
      400,
      `Plus-one meal selections count (${plusOneResponses.length}) exceeds allowed plus-one allocations (${allowedPlusOnes}).`
    );
  }

  const updated = await prisma.invitationCode.update({
    where: { code: targetCode },
    data: {
      rsvpStatus: data.rsvpStatus,
      mealSelection: data.mealSelection || null,
      dietaryNotes: data.dietaryNotes || null,
      plusOneResponses: plusOneResponses as any,
      used: true,
      usedAt: new Date(),
    },
  });

  return NextResponse.json({
    success: true,
    code: updated.code,
    guestName: updated.guestName,
    rsvpStatus: updated.rsvpStatus,
    mealSelection: updated.mealSelection || '',
    dietaryNotes: updated.dietaryNotes || '',
    plusOneResponses: updated.plusOneResponses || [],
  });
});
