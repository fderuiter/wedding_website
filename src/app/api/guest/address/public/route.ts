import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { rateLimit } from '@/utils/rateLimit';
import { prisma } from '@/lib/prisma';
import { PublicAddressCollectSchema, PublicAddressCollectDTO } from '@/features/registry/schemas';

function generateRandomCode(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  // 1. IP Rate Limiting (10 requests per 15 minutes)
  const rateLimitResponse = await rateLimit(req, 10, 15 * 60 * 1000, 'public_address_collect');
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  const body = await req.json().catch(() => ({}));

  // Map convenient aliases if present
  if (!body.guestName && typeof body.name === 'string') {
    body.guestName = body.name;
  }
  if (!body.addressLine1 && typeof body.streetAddress === 'string') {
    body.addressLine1 = body.streetAddress;
  }
  if (!body.zipCode && typeof body.postalCode === 'string') {
    body.zipCode = body.postalCode;
  }
  if (!body.notes && typeof body.householdNotes === 'string') {
    body.notes = body.householdNotes;
  }

  // 2. Honeypot Validation
  const honeypotVal = body.website || body.honeypot || body.hp_field || body.confirm_email;
  if (typeof honeypotVal === 'string' && honeypotVal.trim().length > 0) {
    return NextResponse.json(
      { success: true, message: 'Address submitted successfully.' },
      { status: 200 }
    );
  }

  // 3. Schema Validation
  const parseResult = PublicAddressCollectSchema.safeParse(body);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues[0]?.message || 'Invalid address input.';
    return NextResponse.json(
      { success: false, error: errorMsg, details: parseResult.error.format() },
      { status: 400 }
    );
  }

  const payloadData: PublicAddressCollectDTO = parseResult.data;

  const {
    guestName,
    email,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
    householdName,
    notes,
  } = payloadData;

  // 4. Check for Existing InvitationCode Record (Deduplication)
  const normalizedEmail = email ? email.trim() : '';
  const normalizedGuestName = guestName ? guestName.trim() : '';

  let existingRecord = null;

  if (normalizedEmail) {
    existingRecord = await prisma.invitationCode.findFirst({
      where: {
        email: {
          equals: normalizedEmail,
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  if (!existingRecord && normalizedGuestName) {
    existingRecord = await prisma.invitationCode.findFirst({
      where: {
        guestName: {
          equals: normalizedGuestName,
          mode: 'insensitive',
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  if (existingRecord) {
    const existingTags = Array.isArray(existingRecord.partyTags) ? existingRecord.partyTags : [];
    const updatedPartyTags = existingTags.includes('address-collection')
      ? existingTags
      : [...existingTags, 'address-collection'];

    const existingDietaryNotes = existingRecord.dietaryNotes ? existingRecord.dietaryNotes.trim() : '';
    const newNotes = notes ? notes.trim() : '';
    let updatedDietaryNotes: string | null = existingRecord.dietaryNotes;

    if (existingDietaryNotes) {
      if (newNotes && !existingDietaryNotes.includes(newNotes)) {
        updatedDietaryNotes = `${existingRecord.dietaryNotes}\n${newNotes}`;
      }
    } else if (newNotes) {
      updatedDietaryNotes = newNotes;
    }

    const updatedRecord = await prisma.invitationCode.update({
      where: { id: existingRecord.id },
      data: {
        addressLine1: addressLine1 || null,
        addressLine2: addressLine2 || null,
        city: city || null,
        state: state || null,
        zipCode: zipCode || null,
        country: country || null,
        householdName: householdName || existingRecord.householdName,
        email: normalizedEmail || existingRecord.email,
        dietaryNotes: updatedDietaryNotes,
        partyTags: updatedPartyTags,
      },
    });

    return NextResponse.json(
      {
        success: true,
        message: 'Address submitted successfully.',
        data: {
          id: updatedRecord.id,
          code: updatedRecord.code,
          guestName: updatedRecord.guestName,
          partyTags: updatedRecord.partyTags,
        },
      },
      { status: 200 }
    );
  }

  // 5. Generate Unique Invitation Code
  let uniqueCode = '';
  let attempts = 0;
  while (attempts < 10) {
    const candidate = generateRandomCode();
    const existing = await prisma.invitationCode.findUnique({
      where: { code: candidate },
    });
    if (!existing) {
      uniqueCode = candidate;
      break;
    }
    attempts++;
  }

  if (!uniqueCode) {
    return NextResponse.json(
      { success: false, error: 'Failed to generate invitation code. Please try again.' },
      { status: 500 }
    );
  }

  // 6. Create InvitationCode Record Tagged with 'address-collection'
  const newRecord = await prisma.invitationCode.create({
    data: {
      code: uniqueCode,
      guestName: normalizedGuestName,
      email: normalizedEmail || null,
      addressLine1: addressLine1 || null,
      addressLine2: addressLine2 || null,
      city: city || null,
      state: state || null,
      zipCode: zipCode || null,
      country: country || null,
      householdName: householdName || null,
      dietaryNotes: notes || null,
      partyTags: ['address-collection'],
      used: false,
    },
  });

  return NextResponse.json(
    {
      success: true,
      message: 'Address submitted successfully.',
      data: {
        id: newRecord.id,
        code: newRecord.code,
        guestName: newRecord.guestName,
        partyTags: newRecord.partyTags,
      },
    },
    { status: 200 }
  );
});
