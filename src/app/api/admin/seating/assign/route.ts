import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { SeatingTableAdminService } from '@/features/seating';
import { AssignSeatSchema } from '@/features/seating';
import { ApiError } from '@/utils/ApiError';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  const body = await request.json();
  const parsed = AssignSeatSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, 'Invalid payload: ' + parsed.error.issues.map(i => i.message).join(', '));
  }

  const seatingService = new SeatingTableAdminService();
  const { invitationCodeId, tableId, seatNumber } = parsed.data;

  try {
    const result = await seatingService.assignSeat(invitationCodeId, tableId, seatNumber);
    return NextResponse.json(result);
  } catch (error: any) {
    if (error.message?.includes('Validation Error:')) {
      throw new ApiError(400, error.message);
    }
    throw error;
  }
});
