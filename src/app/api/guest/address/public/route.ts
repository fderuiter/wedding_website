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
import {
  mergeDietaryNotes,
  normalizeBatchInvitationRecord,
  resolveBatchGuestMatches,
} from '@/utils/invitationValidation';

function toPlainObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return { ...(value as Record<string, unknown>) };
  }
  return {};
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  // 1. IP Rate Limiting (10 requests per 15 minutes strictly by client IP)
  const rateLimitResponse = await rateLimit(req, 10, 15 * 60 * 1000, 'public_address_collect', 'general', {
    scope: 'ip',
  });
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

  // 4. Match against active non-sample guests via resolveBatchGuestMatches
  const activeGuests =
    typeof prisma.invitationCode?.findMany === 'function'
      ? await prisma.invitationCode.findMany({
        where: { isSample: false },
      })
      : [];

  const { matches } = resolveBatchGuestMatches(
    [
      normalizeBatchInvitationRecord({
        guestName: normalizedGuestName,
        email: normalizedEmail || null,
        householdName: normalizedHouseholdName || null,
      }),
    ],
    activeGuests
  );

  const matchedCandidate = matches[0]?.matchedRecord ?? null;
  const matchedRecord = matchedCandidate
    ? (activeGuests.find((g) => g.id === matchedCandidate.id) ?? null)
    : null;

  const existingAddressLine1 = matchedRecord?.addressLine1 ? matchedRecord.addressLine1.trim() : '';
  const hasAddressConflict = Boolean(
    matchedRecord &&
      existingAddressLine1 &&
      normalizedAddressLine1 &&
      existingAddressLine1.toLowerCase() !== normalizedAddressLine1.toLowerCase()
  );

  if (matchedRecord && !hasAddressConflict) {
    const updateData: Record<string, unknown> = {};

    if (!(matchedRecord.email ?? '').trim() && normalizedEmail) {
      updateData.email = normalizedEmail;
    }
    if (!(matchedRecord.householdName ?? '').trim() && normalizedHouseholdName) {
      updateData.householdName = normalizedHouseholdName;
    }
    if (!existingAddressLine1 && normalizedAddressLine1) {
      updateData.addressLine1 = normalizedAddressLine1;
    }
    if (!(matchedRecord.addressLine2 ?? '').trim() && normalizedAddressLine2) {
      updateData.addressLine2 = normalizedAddressLine2;
    }
    if (!(matchedRecord.city ?? '').trim() && normalizedCity) {
      updateData.city = normalizedCity;
    }
    if (!(matchedRecord.state ?? '').trim() && normalizedState) {
      updateData.state = normalizedState;
    }
    if (!(matchedRecord.zipCode ?? '').trim() && normalizedZipCode) {
      updateData.zipCode = normalizedZipCode;
    }
    if (!(matchedRecord.country ?? '').trim() && normalizedCountry) {
      updateData.country = normalizedCountry;
    }

    const existingExtra = toPlainObject(matchedRecord.extraFields);
    const nextExtra: Record<string, unknown> = { ...existingExtra };
    let extraChanged = false;

    if (normalizedPhone) {
      const hasPhone = typeof existingExtra.phone === 'string' && existingExtra.phone.trim().length > 0;
      const hasMobile = typeof existingExtra.mobile === 'string' && existingExtra.mobile.trim().length > 0;
      if (!hasPhone) {
        nextExtra.phone = normalizedPhone;
        extraChanged = true;
      }
      if (!hasMobile) {
        nextExtra.mobile = normalizedPhone;
        extraChanged = true;
      }
    }

    if (normalizedNotes) {
      const existingHouseholdNotes =
        typeof existingExtra.householdNotes === 'string' ? existingExtra.householdNotes.trim() : '';
      const combinedHouseholdNotes = existingHouseholdNotes
        ? (mergeDietaryNotes([existingHouseholdNotes, normalizedNotes]) ?? normalizedNotes)
        : normalizedNotes;
      if (combinedHouseholdNotes !== existingHouseholdNotes) {
        nextExtra.householdNotes = combinedHouseholdNotes;
        extraChanged = true;
      }
    }

    if (extraChanged) {
      updateData.extraFields = nextExtra;
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.invitationCode.update({
        where: { id: matchedRecord.id },
        data: updateData as any,
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Address submitted successfully.',
      },
      { status: 200 }
    );
  }

  // 5. Generate Unique Invitation Code for unmatched or conflicting address submission
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

  // 6. Create InvitationCode Record Tagged with 'address-collection' for admin review/merge
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
}, { scope: 'ip' });
