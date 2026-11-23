import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { ApiError } from '@/utils/ApiError';
import {
  INVITATION_MAX_CATALOG_LIMIT,
  clampInvitationPageSize,
} from '@/utils/invitationPagination';
import {
  InvitationCatalogQuerySchema,
  type InvitationSubEventRsvpSummaryDTO,
} from '@/features/registry';
import {
  normalizeMealSelections,
  normalizeCustomAnswers,
  normalizePlusOneNames,
} from '@/utils/rsvpPrompts';

export const GET = withApiMiddleware(async (request: NextRequest) => {
  const { searchParams } = new URL(request.url);
  const rawPage = searchParams.get('page');
  const rawLimit = searchParams.get('limit');
  const rawSearch = searchParams.get('search');
  const rawOrderBy = searchParams.get('orderBy');
  const rawOrderDir = searchParams.get('orderDir');

  const queryInput: Record<string, unknown> = {};
  if (rawPage !== null) queryInput.page = rawPage;
  if (rawLimit !== null) queryInput.limit = rawLimit;
  if (rawSearch !== null && rawSearch.trim() !== '') queryInput.search = rawSearch;
  if (rawOrderBy !== null && rawOrderBy !== '') queryInput.orderBy = rawOrderBy;
  if (rawOrderDir !== null && rawOrderDir !== '') queryInput.orderDir = rawOrderDir;

  const parsed = InvitationCatalogQuerySchema.safeParse(queryInput);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => issue.message).join(', ');
    throw new ApiError(400, `Invalid query parameters: ${details}`);
  }

  const page = parsed.data.page;
  const limit = clampInvitationPageSize(parsed.data.limit, INVITATION_MAX_CATALOG_LIMIT);
  const skip = (page - 1) * limit;
  const { search, orderBy, orderDir } = parsed.data;

  const where = search
    ? {
      OR: [
        { guestName: { contains: search, mode: 'insensitive' as const } },
        { code: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
        { householdName: { contains: search, mode: 'insensitive' as const } },
        { partyGroup: { contains: search, mode: 'insensitive' as const } },
        { dietaryNotes: { contains: search, mode: 'insensitive' as const } },
      ],
    }
    : undefined;

  const [total, records] = await Promise.all([
    prisma.invitationCode.count({ where }),
    prisma.invitationCode.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [orderBy]: orderDir },
      include: {
        subEventRsvps: {
          include: {
            subEvent: {
              select: { id: true, title: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
  ]);

  const items = records.map((record) => {
    const { subEventRsvps, ...rest } = record;
    const mappedRsvps: InvitationSubEventRsvpSummaryDTO[] = (subEventRsvps || []).map((rsvp) => ({
      id: rsvp.id,
      subEventId: rsvp.subEventId,
      subEventTitle: rsvp.subEvent?.title || 'Event',
      status:
        rsvp.status === 'attending' || rsvp.status === 'declined' ? rsvp.status : 'pending',
      plusOneCount: rsvp.plusOneCount ?? 0,
      plusOneNames: normalizePlusOneNames(rsvp.plusOneNames),
      mealSelections: normalizeMealSelections(rsvp.mealSelections),
      dietaryNotes: rsvp.dietaryNotes ?? null,
      customAnswers: normalizeCustomAnswers(rsvp.customAnswers),
      updatedAt: rsvp.updatedAt instanceof Date ? rsvp.updatedAt.toISOString() : undefined,
    }));

    return {
      ...rest,
      subEventRsvps: mappedRsvps,
    };
  });

  const totalPages = limit > 0 ? Math.max(1, Math.ceil(total / limit)) : 1;
  const response = NextResponse.json({
    items,
    total,
    page,
    limit,
    totalPages,
  });

  response.headers.set('X-Total-Count', String(total));
  response.headers.set('X-Page', String(page));
  response.headers.set('X-Limit', String(limit));
  response.headers.set('X-Total-Pages', String(totalPages));

  return response;
});
