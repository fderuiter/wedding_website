import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { rateLimit } from '@/utils/rateLimit';
import { prisma } from '@/lib/prisma';
import {
  PublicAddressCollectSchema,
  PublicAddressCollectDTO,
  generateRandomCode,
} from '@/features/registry';

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
  if (!body.phone && typeof body.mobile === 'string') {
    body.phone = body.mobile;
  }
  if (!body.phone && typeof body.phoneNumber === 'string') {
    body.phone = body.phoneNumber;
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
      { success: false, error: errorMsg, details: z.formatError(parseResult.error) },
      { status: 400 }
    );
  }

  const payloadData: PublicAddressCollectDTO = parseResult.data;

  const {
    guestName,
    email,
    phone,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
    householdName,
    notes,
  } = payloadData;

  const normalizedPhone = phone ? phone.trim() : '';
  const normalizedEmail = email ? email.trim() : '';
  const normalizedGuestName = guestName ? guestName.trim() : '';
  const normalizedHouseholdName = householdName ? householdName.trim() : '';
  const normalizedAddressLine1 = addressLine1 ? addressLine1.trim() : '';
  const normalizedAddressLine2 = addressLine2 ? addressLine2.trim() : '';
  const normalizedCity = city ? city.trim() : '';
  const normalizedState = state ? state.trim() : '';
  const normalizedZipCode = zipCode ? zipCode.trim() : '';
  const normalizedCountry = country ? country.trim() : '';
  const normalizedNotes = notes ? notes.trim() : '';

  // 4. Generate Unique Invitation Code for quarantined address-collection submission
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

  // 5. Create InvitationCode Record Tagged with 'address-collection' for admin review/merge
  const extraFields: Record<string, string> = {};
  if (normalizedPhone) {
    extraFields.phone = normalizedPhone;
    extraFields.mobile = normalizedPhone;
  }
  if (normalizedNotes) {
    extraFields.householdNotes = normalizedNotes;
  }

  const createData: Record<string, unknown> = {
    code: uniqueCode,
    guestName: normalizedGuestName,
    email: normalizedEmail || null,
    addressLine1: normalizedAddressLine1 || null,
    addressLine2: normalizedAddressLine2 || null,
    city: normalizedCity || null,
    state: normalizedState || null,
    zipCode: normalizedZipCode || null,
    country: normalizedCountry || null,
    householdName: normalizedHouseholdName || null,
    dietaryNotes: null,
    partyTags: ['address-collection'],
    used: false,
    ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
  };

  await prisma.invitationCode.create({
    data: createData as any,
  });

  return NextResponse.json(
    {
      success: true,
      message: 'Address submitted successfully.',
    },
    { status: 200 }
  );
});
