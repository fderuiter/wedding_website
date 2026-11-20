import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { SeatingTableAdminService } from '@/features/seating';
import { AutoAssignSchema } from '@/features/seating';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  let author = 'Admin';
  let includePending: boolean | undefined;
  try {
    const body = await request.json();
    const parsed = AutoAssignSchema.safeParse(body);
    if (parsed.success) {
      if (parsed.data?.author) {
        author = parsed.data.author.trim() || 'Admin';
      }
      if (parsed.data?.includePending !== undefined) {
        includePending = parsed.data.includePending;
      }
    }
  } catch {
    // Optional request body
  }

  const seatingService = new SeatingTableAdminService();
  const result =
    includePending !== undefined
      ? await seatingService.autoAssignSeats(author, { includePending })
      : await seatingService.autoAssignSeats(author);
  return NextResponse.json(result);
});
