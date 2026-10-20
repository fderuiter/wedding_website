import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { subEventService } from '@/features/sub-events/service';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const session = await getGuestInviteSession(request);
  const schedule = await subEventService.getScheduleForGuest(session?.code);

  return NextResponse.json({
    success: true,
    data: schedule,
    isGuest: Boolean(session),
    guestName: session?.guestName || null,
  });
});
