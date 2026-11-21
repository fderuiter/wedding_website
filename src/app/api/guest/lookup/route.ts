import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { env } from '@/env';
import { isAdminRequest } from '@/core/auth/auth.server';
import { isGuestRequest } from '@/core/auth/guest.server';
import {
  getGuestInviteSession,
  GUEST_INVITE_COOKIE,
  isAddressVerifiedSession,
  signGuestInviteSessionToken,
} from '@/core/auth/guestInviteSession';
import { ApiError } from '@/utils/ApiError';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { GuestLookupSchema } from '@/utils/validation';

interface LookupCandidateRecord {
  id: string;
  code: string;
  guestName: string;
  email?: string | null;
  zipCode?: string | null;
  householdName?: string | null;
  isSample?: boolean;
}

function normalizePostalForMatch(raw?: string | null): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

function postalCodesMatch(savedPostal?: string | null, inputPostal?: string | null): boolean {
  const saved = normalizePostalForMatch(savedPostal);
  const input = normalizePostalForMatch(inputPostal);
  if (!saved || !input) return false;
  if (saved === input) return true;
  const savedUs5 = saved.match(/^(\d{5})-\d{4}$/)?.[1] ?? (saved.match(/^\d{5}$/)?.[0] || '');
  const inputUs5 = input.match(/^(\d{5})-\d{4}$/)?.[1] ?? (input.match(/^\d{5}$/)?.[0] || '');
  return Boolean(savedUs5 && inputUs5 && savedUs5 === inputUs5);
}

function getDistinctHouseholdGroupKey(record: LookupCandidateRecord): string {
  const hh = record.householdName?.trim().toLowerCase();
  return hh ? `hh:${hh}` : `inv:${record.id}`;
}

export const POST = withApiMiddleware(async (req: NextRequest) => {
  const [isGuest, existingInviteSession, isAdmin] = await Promise.all([
    isGuestRequest(req),
    getGuestInviteSession(req),
    isAdminRequest(req),
  ]);

  if (!isGuest && !existingInviteSession && !isAdmin) {
    throw new ApiError(401, 'Unauthorized. Please enter the event passcode first.');
  }

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

  const { firstName, lastName, query, name, email, zipCode } = parseResult.data;
  const hasStructured = firstName !== undefined || lastName !== undefined;
  const searchName = (
    hasStructured
      ? `${firstName || ''} ${lastName || ''}`
      : (name || query || '')
  )
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = searchName.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    throw new ApiError(400, 'Please enter both your first and last name.');
  }

  const conditions: Prisma.InvitationCodeWhereInput[] = [
    { guestName: { equals: searchName, mode: 'insensitive' } },
  ];

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

  const whereClause: Prisma.InvitationCodeWhereInput = {
    isSample: false,
    OR: conditions,
  };

  let candidates: LookupCandidateRecord[] = [];
  if (typeof prisma.invitationCode.findMany === 'function') {
    const found = await prisma.invitationCode.findMany({
      where: whereClause,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (Array.isArray(found)) {
      candidates = found.filter((c) => c && !c.isSample);
    }
  } else if (typeof prisma.invitationCode.findFirst === 'function') {
    const single = await prisma.invitationCode.findFirst({ where: whereClause });
    if (single && !single.isSample) {
      candidates = [single];
    }
  }

  if (candidates.length === 0) {
    throw new ApiError(404, 'No invitation found matching the provided name.', {
      showLookupHelp: true,
    });
  }

  const cleanEmail = email?.trim().toLowerCase() || '';
  const cleanZip = zipCode?.trim() || '';

  const distinctGroups = new Set(candidates.map(getDistinctHouseholdGroupKey));
  let matchedInvite: LookupCandidateRecord | null = null;

  if (distinctGroups.size === 1 && !cleanEmail && !cleanZip) {
    matchedInvite = candidates[0];
  } else {
    if (distinctGroups.size > 1 && !cleanEmail && !cleanZip) {
      throw new ApiError(
        409,
        'Multiple invitations match that name. Please enter your email address or ZIP/postal code to verify your invitation.',
        { requiresDisambiguation: true }
      );
    }

    // Load household siblings if needed so email/ZIP stored on another member of the same household also matches
    const householdNames = Array.from(
      new Set(
        candidates
          .map((c) => c.householdName?.trim())
          .filter((hh): hh is string => Boolean(hh))
      )
    );
    const householdMembersByLower = new Map<string, LookupCandidateRecord[]>();
    if (householdNames.length > 0 && typeof prisma.invitationCode.findMany === 'function') {
      const siblingRows = await prisma.invitationCode.findMany({
        where: {
          isSample: false,
          OR: householdNames.map((hh) => ({
            householdName: { equals: hh, mode: 'insensitive' as const },
          })),
        },
      });
      if (Array.isArray(siblingRows)) {
        for (const row of siblingRows) {
          const key = row.householdName?.trim().toLowerCase();
          if (!key) continue;
          const list = householdMembersByLower.get(key) || [];
          list.push(row);
          householdMembersByLower.set(key, list);
        }
      }
    }

    const filtered = candidates.filter((candidate) => {
      const hhKey = candidate.householdName?.trim().toLowerCase();
      const pool = hhKey ? (householdMembersByLower.get(hhKey) || [candidate]) : [candidate];

      if (cleanEmail) {
        const emailMatches = pool.some(
          (member) => (member.email?.trim().toLowerCase() || '') === cleanEmail
        );
        if (!emailMatches) return false;
      }

      if (cleanZip) {
        const zipMatches = pool.some((member) => postalCodesMatch(member.zipCode, cleanZip));
        if (!zipMatches) return false;
      }

      return true;
    });

    if (filtered.length === 0) {
      throw new ApiError(404, 'No invitation found matching the provided details.', {
        showLookupHelp: true,
      });
    }

    const filteredGroups = new Set(filtered.map(getDistinctHouseholdGroupKey));
    if (filteredGroups.size > 1) {
      throw new ApiError(
        409,
        'Multiple invitations still match those details. Please enter your email address or personal invitation code.',
        { requiresDisambiguation: true }
      );
    }

    matchedInvite = filtered[0];
  }

  const alreadyVerifiedForSameInvite =
    Boolean(existingInviteSession) &&
    existingInviteSession!.code.trim().toUpperCase() === matchedInvite.code.trim().toUpperCase() &&
    isAddressVerifiedSession(existingInviteSession);

  const iat = Date.now();
  const exp = iat + 7 * 24 * 60 * 60 * 1000;
  const inviteToken = await signGuestInviteSessionToken({
    code: matchedInvite.code,
    guestName: matchedInvite.guestName,
    scope: alreadyVerifiedForSameInvite ? 'full' : 'rsvp',
    addressVerified: alreadyVerifiedForSameInvite,
    iat,
    exp,
  });

  const response = NextResponse.json({
    success: true,
    sessionType: 'name_lookup',
    guestName: matchedInvite.guestName,
    householdName: matchedInvite.householdName || null,
    addressVerified: alreadyVerifiedForSameInvite,
    data: {
      guestName: matchedInvite.guestName,
      householdName: matchedInvite.householdName || null,
      addressVerified: alreadyVerifiedForSameInvite,
    },
  });

  response.cookies.set(GUEST_INVITE_COOKIE, inviteToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return response;
});
