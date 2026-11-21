import { NextRequest, NextResponse } from 'next/server';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { BroadcastService } from '@/features/broadcast';
import { ApiError } from '@/utils/ApiError';
import { GuestLookupAlertSchema } from '@/utils/validation';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const [hasGuestPasscode, inviteSession, isAdmin] = await Promise.all([
    isGuestRequest(req),
    getGuestInviteSession(req),
    isAdminRequest(req),
  ]);

  if (!hasGuestPasscode && !inviteSession && !isAdmin) {
    throw new ApiError(401, 'Unauthorized. Please enter the event passcode first.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parseResult = GuestLookupAlertSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(
      400,
      parseResult.error.issues[0]?.message || 'Please enter a valid name and email address.'
    );
  }

  try {
    await BroadcastService.sendGuestLookupAlert(parseResult.data);
  } catch (err) {
    if (err instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: err.message },
        { status: err.statusCode }
      );
    }
    throw err;
  }

  return NextResponse.json({
    success: true,
    message:
      'We notified the hosts! They will follow up with your invitation details shortly.',
  });
});
