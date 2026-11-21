import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/env';
import {
  getGuestInviteSession,
  GUEST_INVITE_COOKIE,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import { GuestAddressVerifySchema } from '@/features/registry';
import { prisma } from '@/lib/prisma';
import { withApiMiddleware } from '@/utils/withApiMiddleware';

function safeEqualStrings(a: string, b: string): boolean {
  const hashA = createHash('sha256').update(a).digest();
  const hashB = createHash('sha256').update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

function normalizePostalForVerify(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function postalMatchesConstantTime(savedPostal?: string | null, inputPostal?: string | null): boolean {
  const saved = normalizePostalForVerify(savedPostal);
  const input = normalizePostalForVerify(inputPostal);
  if (!saved || !input) return false;
  if (safeEqualStrings(saved, input)) return true;
  const savedUs5 = saved.match(/^(\d{5})-\d{4}$/)?.[1] ?? (saved.match(/^\d{5}$/)?.[0] || '');
  const inputUs5 = input.match(/^(\d{5})-\d{4}$/)?.[1] ?? (input.match(/^\d{5}$/)?.[0] || '');
  return Boolean(savedUs5 && inputUs5 && safeEqualStrings(savedUs5, inputUs5));
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const session = await getGuestInviteSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Please unlock your invitation first.' },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { success: false, error: 'Invalid JSON body.' },
      { status: 400 }
    );
  }

  const parseResult = GuestAddressVerifySchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      {
        success: false,
        error:
          parseResult.error.issues[0]?.message ||
          'Please enter your invitation code or saved ZIP/postal code.',
      },
      { status: 400 }
    );
  }

  const record = await prisma.invitationCode.findUnique({
    where: { code: session.code.toUpperCase(), isSample: false },
  });

  if (!record || record.isSample) {
    return NextResponse.json(
      { success: false, error: 'Invitation not found.' },
      { status: 404 }
    );
  }

  let householdPool = [record];
  const cleanHousehold = record.householdName?.trim() || '';
  if (cleanHousehold && typeof prisma.invitationCode.findMany === 'function') {
    const siblings = await prisma.invitationCode.findMany({
      where: {
        householdName: { equals: cleanHousehold, mode: 'insensitive' },
        isSample: false,
      },
    });
    if (Array.isArray(siblings) && siblings.length > 0) {
      householdPool = siblings.filter((s) => s && !s.isSample);
    }
  }

  const inputCode = (parseResult.data.code || '').trim().toUpperCase();
  const inputZip = (parseResult.data.zipCode || '').trim();

  let verified = false;
  if (inputCode) {
    for (const member of householdPool) {
      if (member.code && safeEqualStrings(member.code.trim().toUpperCase(), inputCode)) {
        verified = true;
      }
    }
  }

  if (!verified && inputZip) {
    const savedZips = householdPool
      .map((member) => member.zipCode)
      .filter((z): z is string => typeof z === 'string' && z.trim().length > 0);
    for (const savedZip of savedZips) {
      if (postalMatchesConstantTime(savedZip, inputZip)) {
        verified = true;
      }
    }
  }

  if (!verified) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Verification failed. Please double-check your invitation code or saved ZIP/postal code.',
      },
      { status: 401 }
    );
  }

  const iat = Date.now();
  const exp = iat + 7 * 24 * 60 * 60 * 1000;
  const upgradedToken = await signGuestInviteSessionToken({
    code: record.code,
    guestName: record.guestName,
    scope: 'full',
    addressVerified: true,
    iat,
    exp,
  });

  const response = NextResponse.json({
    success: true,
    addressVerified: true,
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

  response.cookies.set(GUEST_INVITE_COOKIE, upgradedToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
});
