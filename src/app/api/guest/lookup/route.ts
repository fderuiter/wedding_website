import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { hasAddressCollectionTag } from '@/features/registry';
import { prisma } from '@/lib/prisma';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { GuestLookupSchema } from '@/utils/validation';

export const POST = withApiMiddleware(async (req: NextRequest) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, 'Invalid JSON body.');
  }

  const parseResult = GuestLookupSchema.safeParse(body);
  if (!parseResult.success) {
    throw new ApiError(400, parseResult.error.issues[0].message);
  }

  const { query, name, email } = parseResult.data;
  const searchEmail = email?.trim() || (query?.includes('@') ? query.trim() : undefined);
  const searchName = name?.trim() || (!query?.includes('@') ? query?.trim() : undefined);

  const conditions: Prisma.InvitationCodeWhereInput[] = [];
  if (searchEmail) {
    conditions.push({ email: { equals: searchEmail, mode: 'insensitive' } });
  }
  if (searchName) {
    conditions.push({ guestName: { equals: searchName, mode: 'insensitive' } });

    const tokens = searchName.split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      for (let i = 1; i < tokens.length; i++) {
        const first = tokens.slice(0, i).join(' ');
        const last = tokens.slice(i).join(' ');
        conditions.push({
          AND: [
            { plusOneFirstName: { equals: first, mode: 'insensitive' } },
            { plusOneLastName: { equals: last, mode: 'insensitive' } },
          ],
        });
      }
    }
  }

  const baseCondition = conditions.length === 1 ? conditions[0] : { OR: conditions };
  let invite = conditions.length > 0
    ? await prisma.invitationCode.findFirst({
      where: {
        isSample: false,
        ...baseCondition,
      },
    })
    : null;

  if (invite && hasAddressCollectionTag(invite.partyTags)) {
    invite = await prisma.invitationCode.findFirst({
      where: {
        isSample: false,
        NOT: {
          partyTags: {
            has: 'address-collection',
          },
        },
        ...baseCondition,
      },
    });
  }

  if (!invite || invite.isSample || hasAddressCollectionTag(invite.partyTags)) {
    throw new ApiError(404, 'No invitation found matching the provided details.');
  }

  return NextResponse.json({
    success: true,
    guestName: invite.guestName,
    data: {
      guestName: invite.guestName,
    },
  });
});
