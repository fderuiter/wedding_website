import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { SeatingTableAdminService, AutoAssignSchema, type AutoAssignOptions } from '@/features/seating';

export const POST = withApiMiddleware(async (request: NextRequest) => {
  let author = 'Admin';
  const options: AutoAssignOptions = {};

  try {
    const body = await request.json();
    const parsed = AutoAssignSchema.safeParse(body);
    if (parsed.success) {
      if (parsed.data?.author) {
        author = parsed.data.author.trim() || 'Admin';
      }
      if (parsed.data?.includePending !== undefined) {
        options.includePending = parsed.data.includePending;
      }
      if (parsed.data?.keepHouseholdsIntact !== undefined) {
        options.keepHouseholdsIntact = parsed.data.keepHouseholdsIntact;
      }
      if (parsed.data?.partyGroup !== undefined) {
        options.partyGroup = parsed.data.partyGroup;
      }
      if (parsed.data?.partyTags !== undefined) {
        options.partyTags = parsed.data.partyTags;
      }
    }
  } catch {
    // Optional request body
  }

  const seatingService = new SeatingTableAdminService();
  const hasOptions = Object.keys(options).length > 0;
  const result = hasOptions
    ? await seatingService.autoAssignSeats(author, options)
    : await seatingService.autoAssignSeats(author);
  return NextResponse.json(result);
});
