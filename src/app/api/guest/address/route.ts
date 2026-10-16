import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { prisma } from '@/lib/prisma';
import { GuestAddressUpdateSchema } from '@/features/registry/schemas';

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const session = await getGuestInviteSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Please enter your invitation code.' },
      { status: 401 }
    );
  }

  const record = await prisma.invitationCode.findUnique({
    where: { code: session.code.toUpperCase() },
  });

  if (!record) {
    return NextResponse.json(
      { success: false, error: 'Invitation code not found.' },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    data: {
      guestName: record.guestName,
      code: record.code,
      addressLine1: record.addressLine1 || '',
      addressLine2: record.addressLine2 || '',
      city: record.city || '',
      state: record.state || '',
      zipCode: record.zipCode || '',
      country: record.country || '',
    },
  });
});

export const PUT = withApiMiddleware(async (req: NextRequest) => {
  const session = await getGuestInviteSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Please enter your invitation code.' },
      { status: 401 }
    );
  }

  const body = await req.json();
  const parseResult = GuestAddressUpdateSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json(
      { success: false, error: parseResult.error.issues[0]?.message || 'Invalid address input.' },
      { status: 400 }
    );
  }

  const existing = await prisma.invitationCode.findUnique({
    where: { code: session.code.toUpperCase() },
  });

  if (!existing) {
    return NextResponse.json(
      { success: false, error: 'Invitation code not found.' },
      { status: 404 }
    );
  }

  const { addressLine1, addressLine2, city, state, zipCode, country } = parseResult.data;

  const updated = await prisma.invitationCode.update({
    where: { code: session.code.toUpperCase() },
    data: {
      addressLine1: addressLine1 ?? null,
      addressLine2: addressLine2 ?? null,
      city: city ?? null,
      state: state ?? null,
      zipCode: zipCode ?? null,
      country: country ?? null,
    },
  });

  return NextResponse.json({
    success: true,
    data: {
      guestName: updated.guestName,
      code: updated.code,
      addressLine1: updated.addressLine1 || '',
      addressLine2: updated.addressLine2 || '',
      city: updated.city || '',
      state: updated.state || '',
      zipCode: updated.zipCode || '',
      country: updated.country || '',
    },
  });
});
