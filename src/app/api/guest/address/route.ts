import { NextRequest, NextResponse } from 'next/server';
import { withApiMiddleware } from '@/utils/withApiMiddleware';
import { parseJsonRequestBody } from '@/utils/contentType';
import { getGuestInviteSession } from '@/core/auth/guestInviteSession';
import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import {
  getHydratedGuestInvitation,
  updateHydratedGuestInvitation,
} from '@/lib/requestContext';
import {
  GuestAddressUpdateSchema,
  deriveHouseholdMembersFromInvitation,
  type HouseholdMemberDTO,
} from '@/features/registry';
import { mergeDietaryNotes, splitMemberFullName } from '@/utils/invitationValidation';

interface HouseholdMemberDelegate {
  findMany?: (args: {
    where: { invitationCodeId: string };
    orderBy: { displayOrder: 'asc' };
  }) => Promise<HouseholdMemberDTO[]>;
  update?: (args: {
    where: { id: string };
    data: Record<string, unknown>;
  }) => Promise<HouseholdMemberDTO>;
  create?: (args: {
    data: Record<string, unknown>;
  }) => Promise<HouseholdMemberDTO>;
}

function getHouseholdMemberDelegate(): HouseholdMemberDelegate | undefined {
  const candidate = (prisma as unknown as { householdMember?: HouseholdMemberDelegate })
    ?.householdMember;
  return candidate && typeof candidate.findMany === 'function' ? candidate : undefined;
}

function parseExtraObject(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? { ...(parsed as Record<string, unknown>) }
        : {};
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    return { ...(raw as Record<string, unknown>) };
  }
  return {};
}

export const GET = withApiMiddleware(async (req: NextRequest) => {
  const session = await getGuestInviteSession(req);
  if (!session) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized. Please enter your invitation code.' },
      { status: 401 }
    );
  }

  const record =
    getHydratedGuestInvitation(session.code, req) ??
    (await prisma.invitationCode.findUnique({
      where: { code: session.code.toUpperCase(), isSample: false },
    }));

  if (!record || record.isSample) {
    return NextResponse.json(
      { success: false, error: 'Invitation code not found.' },
      { status: 404 }
    );
  }

  const memberDelegate = getHouseholdMemberDelegate();
  const includeRoster =
    req.nextUrl?.searchParams?.get('includeRoster') === '1' ||
    req.nextUrl?.searchParams?.get('includeRoster') === 'true';

  let membersPayload: HouseholdMemberDTO[] | undefined;
  if (includeRoster || memberDelegate) {
    const dbMembers =
      memberDelegate && record.id
        ? await memberDelegate.findMany!({
          where: { invitationCodeId: record.id },
          orderBy: { displayOrder: 'asc' },
        })
        : undefined;
    if (includeRoster || Array.isArray(dbMembers)) {
      membersPayload = deriveHouseholdMembersFromInvitation({
        ...record,
        members: Array.isArray(dbMembers) && dbMembers.length > 0 ? dbMembers : undefined,
      });
    }
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
      ...(membersPayload !== undefined
        ? {
          householdName: record.householdName || '',
          members: membersPayload,
        }
        : {}),
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

  const body = await parseJsonRequestBody(req);
  const parseResult = GuestAddressUpdateSchema.safeParse(body);

  if (!parseResult.success) {
    return NextResponse.json(
      { success: false, error: parseResult.error.issues[0]?.message || 'Invalid address input.' },
      { status: 400 }
    );
  }

  const existing =
    getHydratedGuestInvitation(session.code, req) ??
    (await prisma.invitationCode.findUnique({
      where: { code: session.code.toUpperCase(), isSample: false },
    }));

  if (!existing || existing.isSample) {
    return NextResponse.json(
      { success: false, error: 'Invitation code not found.' },
      { status: 404 }
    );
  }

  const {
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    country,
    householdName,
    members: submittedMembers,
  } = parseResult.data;

  const isRosterUpdate = submittedMembers !== undefined || householdName !== undefined;
  const memberDelegate = getHouseholdMemberDelegate();

  const updateData: Prisma.InvitationCodeUpdateInput = isRosterUpdate
    ? {
      ...(addressLine1 !== undefined ? { addressLine1: addressLine1 ?? null } : {}),
      ...(addressLine2 !== undefined ? { addressLine2: addressLine2 ?? null } : {}),
      ...(city !== undefined ? { city: city ?? null } : {}),
      ...(state !== undefined ? { state: state ?? null } : {}),
      ...(zipCode !== undefined ? { zipCode: zipCode ?? null } : {}),
      ...(country !== undefined ? { country: country ?? null } : {}),
      ...(householdName !== undefined ? { householdName: householdName || null } : {}),
    }
    : {
      addressLine1: addressLine1 ?? null,
      addressLine2: addressLine2 ?? null,
      city: city ?? null,
      state: state ?? null,
      zipCode: zipCode ?? null,
      country: country ?? null,
    };

  let resolvedMembers: HouseholdMemberDTO[] | undefined;

  if (submittedMembers && submittedMembers.length > 0) {
    const dbMembers =
      memberDelegate && existing.id
        ? await memberDelegate.findMany!({
          where: { invitationCodeId: existing.id },
          orderBy: { displayOrder: 'asc' },
        })
        : undefined;
    const baselineMembers = deriveHouseholdMembersFromInvitation({
      ...existing,
      members: Array.isArray(dbMembers) && dbMembers.length > 0 ? dbMembers : undefined,
    });
    const dbIds = new Set((dbMembers ?? []).map((m) => m.id));
    const submittedById = new Map(submittedMembers.map((m) => [m.id, m]));

    const nextMembers: HouseholdMemberDTO[] = [];
    for (const member of baselineMembers) {
      const incoming = submittedById.get(member.id);
      if (!incoming) {
        nextMembers.push(member);
        continue;
      }
      const nextFullName = incoming.fullName.trim();
      const split = splitMemberFullName(nextFullName);
      const nextEmail =
        incoming.email !== undefined ? (incoming.email ? incoming.email.trim() : null) : member.email;
      const nextPhone =
        incoming.phone !== undefined ? (incoming.phone ? incoming.phone.trim() : null) : member.phone;
      const nextDietary =
        incoming.dietaryNotes !== undefined
          ? incoming.dietaryNotes && incoming.dietaryNotes.trim()
            ? incoming.dietaryNotes.trim()
            : null
          : member.dietaryNotes;

      const updatedMember: HouseholdMemberDTO = {
        ...member,
        fullName: nextFullName,
        firstName: split.firstName,
        lastName: split.lastName,
        email: nextEmail,
        phone: nextPhone,
        dietaryNotes: nextDietary,
      };

      if (memberDelegate && existing.id) {
        if (dbIds.has(member.id) && typeof memberDelegate.update === 'function') {
          await memberDelegate.update({
            where: { id: member.id },
            data: {
              fullName: updatedMember.fullName,
              firstName: updatedMember.firstName,
              lastName: updatedMember.lastName,
              email: updatedMember.email,
              phone: updatedMember.phone,
              dietaryNotes: updatedMember.dietaryNotes,
            },
          });
        } else if (!dbIds.has(member.id) && typeof memberDelegate.create === 'function') {
          const created = await memberDelegate.create({
            data: {
              invitationCodeId: existing.id,
              fullName: updatedMember.fullName,
              firstName: updatedMember.firstName,
              lastName: updatedMember.lastName,
              role: updatedMember.role,
              email: updatedMember.email,
              phone: updatedMember.phone,
              dietaryNotes: updatedMember.dietaryNotes,
              tags: updatedMember.tags,
              displayOrder: updatedMember.displayOrder,
              seatNumber: updatedMember.seatNumber,
            },
          });
          updatedMember.id = created.id;
        }
      }

      nextMembers.push(updatedMember);
    }

    resolvedMembers = nextMembers;
    const primary = nextMembers.find((m) => m.role === 'PRIMARY') ?? nextMembers[0];
    if (primary) {
      updateData.guestName = primary.fullName;
      updateData.email = primary.email;
    }
    updateData.dietaryNotes = mergeDietaryNotes(nextMembers.map((m) => m.dietaryNotes));

    const companions = nextMembers.filter((m) => m.id !== primary?.id);
    if (companions.length > 0) {
      const firstCompanion = companions[0];
      updateData.plusOneFirstName = firstCompanion.firstName;
      updateData.plusOneLastName = firstCompanion.lastName;
      const nextExtra = parseExtraObject(existing.extraFields);
      nextExtra.plusOneNames = companions.map((c) => c.fullName);
      if (primary?.phone) {
        nextExtra.phone = primary.phone;
      }
      updateData.extraFields = nextExtra as Prisma.InputJsonValue;
    } else if (primary?.phone) {
      const nextExtra = parseExtraObject(existing.extraFields);
      nextExtra.phone = primary.phone;
      updateData.extraFields = nextExtra as Prisma.InputJsonValue;
    }
  }

  const updated = await prisma.invitationCode.update({
    where: { code: session.code.toUpperCase() },
    data: updateData,
  });

  updateHydratedGuestInvitation(
    session.code,
    {
      guestName: updated.guestName ?? existing.guestName,
      householdName: updated.householdName ?? existing.householdName ?? null,
      email: updated.email ?? existing.email ?? null,
      dietaryNotes: updated.dietaryNotes ?? existing.dietaryNotes ?? null,
      plusOneFirstName: updated.plusOneFirstName ?? existing.plusOneFirstName ?? null,
      plusOneLastName: updated.plusOneLastName ?? existing.plusOneLastName ?? null,
      extraFields: updated.extraFields ?? existing.extraFields ?? null,
      addressLine1: updated.addressLine1 ?? null,
      addressLine2: updated.addressLine2 ?? null,
      city: updated.city ?? null,
      state: updated.state ?? null,
      zipCode: updated.zipCode ?? null,
      country: updated.country ?? null,
      ...(resolvedMembers
        ? {
          members: resolvedMembers.map((m, idx) => ({
            id: m.id,
            invitationCodeId: m.invitationCodeId ?? existing.id,
            fullName: m.fullName,
            firstName: m.firstName ?? null,
            lastName: m.lastName ?? null,
            role: m.role,
            email: m.email ?? null,
            phone: m.phone ?? null,
            dietaryNotes: m.dietaryNotes ?? null,
            tags: m.tags,
            displayOrder: m.displayOrder ?? idx,
            seatNumber: m.seatNumber ?? null,
          })),
        }
        : {}),
    },
    req
  );

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
      ...(isRosterUpdate || resolvedMembers
        ? {
          householdName: updated.householdName || '',
          members:
            resolvedMembers ??
            deriveHouseholdMembersFromInvitation({
              ...updated,
            }),
        }
        : {}),
    },
  });
});
