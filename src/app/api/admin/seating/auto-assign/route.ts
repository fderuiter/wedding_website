import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { SeatingTableAdminService } from '@/features/seating/admin.service';
import { AutoAssignSchema } from '@/features/seating/schemas';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  let author = 'Admin';
  try {
    const body = await request.json();
    const parsed = AutoAssignSchema.safeParse(body);
    if (parsed.success && parsed.data?.author) {
      author = parsed.data.author.trim() || 'Admin';
    }
  } catch {
    // Optional request body
  }

  const seatingService = new SeatingTableAdminService();
  const result = await seatingService.autoAssignSeats(author);
  return NextResponse.json(result);
});
