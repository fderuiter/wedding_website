import { z } from 'zod';
import { buildArchetypeSeedData } from '@/lib/sampleData/builder';
import { createIcsFile, formatScheduleEventToCalendarEvent } from '@/utils/calendar';
import {
  DEFAULT_RSVP_CLOSED_MESSAGE,
  evaluateRsvpCutoff,
} from '@/utils/rsvpDeadline';
import {
  normalizeCustomAnswers,
  normalizeCustomQuestions,
  normalizeMealOptions,
  normalizeMealSelections,
  normalizePlusOneNames,
} from '@/utils/rsvpPrompts';
import {
  ADDRESS_LINE_MAX_LENGTH,
  CITY_MAX_LENGTH,
  COUNTRY_MAX_LENGTH,
  GUEST_NAME_MAX_LENGTH,
  HOUSEHOLD_NAME_MAX_LENGTH,
  normalizePartyTags,
  PHONE_MAX_LENGTH,
  splitMemberFullName,
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
} from '@/utils/invitationValidation';
import type { HouseholdMemberDTO, HouseholdMemberRole, InvitationCodeDTO } from '@/features/registry';
import {
  buildDemoHouseholdMembersForGuest,
  type DemoSubEventMemberRsvpRecord,
  type DemoSubEventRsvpRecord,
} from '../demoSeed';
import {
  findDemoGuestByCode,
  getActiveArchetypeDataset,
  getDemoState,
  getEffectiveDemoSettings,
  mutateActiveDataset,
  recordDemoAuditVersion,
  setDemoGuestSession,
  updateDemoGuestAddress,
} from '../demoStore';
import {
  type DemoRouteContext,
  binaryResponse,
  jsonResponse,
  nextDemoId,
  parseJsonBody,
  upsertInvitationsIntoStaticDemoStore,
} from './http';

const DISALLOWED_DEMO_PUBLIC_TEXT_PATTERN = /[<>]|[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const DEMO_PHONE_PATTERN = /^\+?[\d\s()./-]{7,30}$/;
const DEMO_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHARED_DEMO_PASSCODES = new Set(['WEDDING2026', 'DEMO2026', 'GUEST2026']);

function generateDemoInvitationCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += DEMO_CODE_CHARS[Math.floor(Math.random() * DEMO_CODE_CHARS.length)];
  }
  return code;
}

function isAddressCollectionOnly(partyTags: unknown): boolean {
  return normalizePartyTags(partyTags).includes('address-collection');
}

function createRequiredDemoPostalField(max: number, label: string) {
  return z
    .string({ message: `${label} is required.` })
    .refine((val) => !DISALLOWED_DEMO_PUBLIC_TEXT_PATTERN.test(val), {
      message: `${label} cannot contain HTML brackets or control characters.`,
    })
    .trim()
    .min(1, `${label} is required and must be under ${max} characters.`)
    .max(max, `${label} is required and must be under ${max} characters.`);
}

function createOptionalDemoPostalField(max: number, label: string) {
  return z
    .string()
    .refine((val) => !DISALLOWED_DEMO_PUBLIC_TEXT_PATTERN.test(val), {
      message: `${label} cannot contain HTML brackets or control characters.`,
    })
    .trim()
    .max(max, `${label} must be under ${max} characters.`)
    .optional()
    .or(z.literal(''))
    .nullable();
}

const DemoPublicPartnerSchema = z.object({
  fullName: createRequiredDemoPostalField(GUEST_NAME_MAX_LENGTH, 'Partner name'),
  email: z.string().trim().email('Invalid partner email.').optional().or(z.literal('')).nullable(),
  phone: z.string().trim().max(PHONE_MAX_LENGTH).optional().or(z.literal('')).nullable(),
  dietaryNotes: createOptionalDemoPostalField(500, 'Partner dietary notes'),
});

const DemoPublicChildSchema = z.object({
  fullName: createRequiredDemoPostalField(GUEST_NAME_MAX_LENGTH, 'Child name'),
  dietaryNotes: createOptionalDemoPostalField(500, 'Child dietary notes'),
  isKidsMeal: z.boolean().optional(),
});

const DemoPublicAddressCollectSchema = z.object({
  guestName: createRequiredDemoPostalField(GUEST_NAME_MAX_LENGTH, 'Guest name'),
  email: z.string().trim().email('Invalid email address.').optional().or(z.literal('')).nullable(),
  phone: z
    .string()
    .trim()
    .max(PHONE_MAX_LENGTH, `Phone number must be under ${PHONE_MAX_LENGTH} characters.`)
    .refine(
      (val) => {
        if (!val) return true;
        if (!DEMO_PHONE_PATTERN.test(val)) return false;
        return val.replace(/\D/g, '').length >= 7;
      },
      { message: 'Invalid phone number format.' }
    )
    .optional()
    .nullable(),
  dietaryNotes: createOptionalDemoPostalField(500, 'Dietary notes'),
  addressLine1: createRequiredDemoPostalField(ADDRESS_LINE_MAX_LENGTH, 'Street address'),
  addressLine2: createOptionalDemoPostalField(ADDRESS_LINE_MAX_LENGTH, 'Address Line 2'),
  city: createRequiredDemoPostalField(CITY_MAX_LENGTH, 'City'),
  state: createRequiredDemoPostalField(STATE_MAX_LENGTH, 'State / Province'),
  zipCode: createRequiredDemoPostalField(ZIP_CODE_MAX_LENGTH, 'ZIP / Postal code'),
  country: createOptionalDemoPostalField(COUNTRY_MAX_LENGTH, 'Country'),
  householdName: createOptionalDemoPostalField(HOUSEHOLD_NAME_MAX_LENGTH, 'Household name'),
  notes: z
    .string()
    .trim()
    .max(1000, 'Notes must be under 1000 characters.')
    .optional()
    .or(z.literal(''))
    .nullable(),
  partner: DemoPublicPartnerSchema.optional().nullable(),
  children: z.array(DemoPublicChildSchema).max(10).optional(),
});

function toClientRsvpStatus(
  status: string | undefined | null
): 'attending' | 'declined' | 'pending' {
  const normalized = String(status ?? 'pending').trim().toLowerCase();
  if (normalized === 'attending') return 'attending';
  if (normalized === 'declined') return 'declined';
  return 'pending';
}

function buildScheduleForGuest(invitationCode?: string | null) {
  const dataset = getActiveArchetypeDataset();
  const normalizedCode = typeof invitationCode === 'string' ? invitationCode.trim() : '';
  const matchedGuest = normalizedCode ? findDemoGuestByCode(normalizedCode) : null;

  const accessibleSubEvents = dataset.subEvents
    .filter((evt) => {
      if (!evt.isPrivate) return true;
      if (!matchedGuest) return false;
      return dataset.subEventAccess.some(
        (acc) => acc.subEventId === evt.id && acc.invitationCodeId === matchedGuest.id
      );
    })
    .sort((a, b) => {
      const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
      const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
      return aTime - bTime;
    });

  const baseDietary = (matchedGuest?.dietaryNotes || '').trim();

  return accessibleSubEvents.map((evt) => {
    const rsvp = matchedGuest
      ? dataset.subEventRsvps.find(
        (entry) => entry.subEventId === evt.id && entry.invitationCodeId === matchedGuest.id
      ) ?? null
      : null;

    const startIso =
      evt.startTime instanceof Date
        ? evt.startTime.toISOString()
        : typeof evt.startTime === 'string'
          ? evt.startTime
          : null;
    const endIso =
      evt.endTime instanceof Date
        ? evt.endTime.toISOString()
        : typeof evt.endTime === 'string'
          ? evt.endTime
          : null;

    const guestMembers = matchedGuest ? buildDemoHouseholdMembersForGuest(matchedGuest) : [];
    const userRsvp = rsvp
      ? {
        status: toClientRsvpStatus(rsvp.status),
        plusOneCount: rsvp.plusOneCount ?? 0,
        dietaryNotes: rsvp.dietaryNotes ?? '',
        mealSelections: normalizeMealSelections(rsvp.mealSelections),
        customAnswers: normalizeCustomAnswers(rsvp.customAnswers),
        plusOneNames: normalizePlusOneNames(rsvp.plusOneNames),
        memberRsvps:
          rsvp.memberRsvps && rsvp.memberRsvps.length > 0
            ? rsvp.memberRsvps.map((mr) => ({
              householdMemberId: mr.householdMemberId,
              status: mr.status,
              mealOptionId: mr.mealOptionId ?? null,
              dietaryNotes: mr.dietaryNotes ?? null,
            }))
            : guestMembers.map((m, mIdx) => {
              const clientStatus = toClientRsvpStatus(rsvp.status);
              const cap = clientStatus === 'attending' ? 1 + Math.max(0, rsvp.plusOneCount ?? 0) : 0;
              const mStatus =
                clientStatus === 'declined'
                  ? ('declined' as const)
                  : clientStatus === 'pending'
                    ? ('pending' as const)
                    : mIdx < cap
                      ? ('attending' as const)
                      : ('declined' as const);
              const normalizedMeals = normalizeMealSelections(rsvp.mealSelections);
              return {
                householdMemberId: m.id,
                status: mStatus,
                mealOptionId: mStatus === 'attending' ? (normalizedMeals[mIdx] ?? null) : null,
                dietaryNotes: mStatus === 'declined' ? null : (m.dietaryNotes ?? null),
              };
            }),
      }
      : matchedGuest && baseDietary
        ? {
          status: 'pending' as const,
          plusOneCount: 0,
          dietaryNotes: baseDietary,
        }
        : null;

    return {
      id: evt.id,
      title: evt.title,
      description: evt.description || '',
      startTime: startIso,
      endTime: endIso,
      locationName: evt.locationName || '',
      location: evt.location || '',
      category: evt.category || 'Wedding Weekend',
      isPrivate: Boolean(evt.isPrivate),
      isReadOnly: false,
      attireRules:
        'attireRules' in evt && typeof evt.attireRules === 'string' ? evt.attireRules : null,
      mealOptions: normalizeMealOptions(evt.mealOptions),
      customQuestions: normalizeCustomQuestions(evt.customQuestions),
      userRsvp,
    };
  });
}

export async function handleGuestRoutes(ctx: DemoRouteContext): Promise<Response | null> {
  const { path, method, init, rawInput } = ctx;

  // 1. Unified Guest Session Endpoint (#1277)
  if (path === '/api/guest/session') {
    if (method === 'DELETE') {
      setDemoGuestSession(null);
      return jsonResponse({
        status: 'none',
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        hasPasscodeSession: false,
      });
    }
    if (method === 'GET') {
      const session = getDemoState().guestSession;
      const activeGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
      if (!session || !activeGuest) {
        return jsonResponse({
          status: 'none',
          isVerified: false,
          invitationCode: null,
          code: null,
          guestName: null,
          hasPasscodeSession: false,
        });
      }
      return jsonResponse({
        status: 'invitation',
        isVerified: true,
        invitationCode: activeGuest.code,
        code: activeGuest.code,
        guestName: activeGuest.guestName || session.guestName,
        hasPasscodeSession: false,
      });
    }
  }

  // 2. Guest Login & Passcode / Invite Session
  if (path === '/api/guest/login' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const rawCode = String(body.passcode ?? body.code ?? '').trim();
    if (!rawCode) {
      return jsonResponse({ success: false, error: 'Invitation code or passcode is required.' }, 400);
    }

    const matchedGuest = findDemoGuestByCode(rawCode);
    if (matchedGuest) {
      setDemoGuestSession({
        invitationCode: matchedGuest.code,
        guestName: matchedGuest.guestName,
      });
      const nowIso = new Date().toISOString();
      mutateActiveDataset((current) => ({
        ...current,
        broadcastMessages: current.broadcastMessages.map((msg) => {
          let changed = false;
          const nextRecipients = msg.recipients.map((rcpt) => {
            if (
              rcpt.invitationCodeId === matchedGuest.id &&
              (rcpt.status === 'SENT' || rcpt.status === 'DELIVERED')
            ) {
              changed = true;
              return { ...rcpt, status: 'VIEWED' as const, viewedAt: nowIso };
            }
            return rcpt;
          });
          if (!changed) return msg;
          return {
            ...msg,
            recipients: nextRecipients,
            viewedCount: nextRecipients.filter((r) => r.status === 'VIEWED').length,
          };
        }),
      }));

      const payload = {
        success: true,
        authenticated: true,
        sessionType: 'invite' as const,
        code: matchedGuest.code,
        guestName: matchedGuest.guestName,
      };
      return jsonResponse({ ...payload, data: payload });
    }

    const upperCode = rawCode.toUpperCase();
    if (SHARED_DEMO_PASSCODES.has(upperCode)) {
      const firstInvitee = getActiveArchetypeDataset().guests.find(
        (g) => !isAddressCollectionOnly(g.partyTags)
      );
      if (firstInvitee) {
        setDemoGuestSession({
          invitationCode: firstInvitee.code,
          guestName: firstInvitee.guestName,
        });
      }
      const payload = {
        success: true,
        authenticated: true,
        sessionType: 'shared' as const,
        code: firstInvitee?.code ?? upperCode,
        guestName: firstInvitee?.guestName ?? 'Invited Guest',
      };
      return jsonResponse({ ...payload, data: payload });
    }

    return jsonResponse(
      {
        success: false,
        error: 'Invalid invitation code or passcode.',
      },
      401
    );
  }

  // 3. Guest Invitation Lookup (by name, email, or household)
  if (path === '/api/guest/lookup' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const rawEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const rawName = String(
      body.name ?? body.guestName ?? body.fullName ?? body.query ?? ''
    )
      .trim()
      .toLowerCase();

    if (!rawEmail && rawName.length < 2) {
      return jsonResponse(
        {
          success: false,
          error: 'Please enter your full name or email address to look up your invitation.',
        },
        400
      );
    }

    const candidates = getActiveArchetypeDataset().guests.filter(
      (g) => !isAddressCollectionOnly(g.partyTags)
    );
    const matches = candidates.filter((g) => {
      const adultMembers = buildDemoHouseholdMembersForGuest(g).filter(
        (m) => m.role !== 'CHILD'
      );
      if (rawEmail) {
        if (g.email && g.email.trim().toLowerCase() === rawEmail) {
          return true;
        }
        if (adultMembers.some((m) => m.email && m.email.trim().toLowerCase() === rawEmail)) {
          return true;
        }
      }
      if (rawName) {
        const guestName = g.guestName.toLowerCase();
        const householdName = (g.householdName || '').toLowerCase();
        if (guestName.includes(rawName) || householdName.includes(rawName)) {
          return true;
        }
        if (adultMembers.some((m) => m.fullName.toLowerCase().includes(rawName))) {
          return true;
        }
      }
      return false;
    });
    const matched = matches[0];

    if (!matched) {
      return jsonResponse(
        {
          success: false,
          error: 'No matching invitation was found. Please check your spelling or contact the couple.',
        },
        404
      );
    }

    const matchSummaries = matches.map((g) => ({
      code: g.code,
      guestName: g.guestName,
      householdName: g.householdName ?? '',
    }));
    const payload = {
      found: true,
      code: matched.code,
      guestName: matched.guestName,
      householdName: matched.householdName ?? '',
      matches: matchSummaries,
    };
    return jsonResponse({
      success: true,
      ...payload,
      data: payload,
    });
  }

  // 4. Guest Logout
  if (path === '/api/guest/logout' && method === 'POST') {
    setDemoGuestSession(null);
    return jsonResponse({ success: true, data: { success: true } });
  }

  // 5. Public Address Collection
  if (path === '/api/guest/address/public' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    if (!body.guestName && typeof body.name === 'string') body.guestName = body.name;
    if (!body.addressLine1 && typeof body.streetAddress === 'string') {
      body.addressLine1 = body.streetAddress;
    }
    if (!body.zipCode && typeof body.postalCode === 'string') body.zipCode = body.postalCode;
    if (!body.notes && typeof body.householdNotes === 'string') body.notes = body.householdNotes;
    if (!body.phone && typeof body.mobile === 'string') body.phone = body.mobile;
    if (!body.phone && typeof body.phoneNumber === 'string') body.phone = body.phoneNumber;

    const honeypotVal = body.website || body.honeypot || body.hp_field || body.confirm_email;
    if (typeof honeypotVal === 'string' && honeypotVal.trim().length > 0) {
      return jsonResponse({ success: true, message: 'Address submitted successfully.' });
    }

    const parseResult = DemoPublicAddressCollectSchema.safeParse(body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues[0]?.message || 'Invalid address input.';
      return jsonResponse(
        { success: false, error: errorMsg, details: z.formatError(parseResult.error) },
        400
      );
    }

    const payload = parseResult.data;
    const existingCodes = new Set(
      getActiveArchetypeDataset().guests.map((g) => g.code.toUpperCase())
    );
    let uniqueCode = generateDemoInvitationCode();
    let attempts = 0;
    while (existingCodes.has(uniqueCode.toUpperCase()) && attempts < 10) {
      uniqueCode = generateDemoInvitationCode();
      attempts += 1;
    }

    const extraFields: Record<string, string> = {};
    if (payload.phone?.trim()) {
      extraFields.phone = payload.phone.trim();
      extraFields.mobile = payload.phone.trim();
    }
    if (payload.notes?.trim()) {
      extraFields.householdNotes = payload.notes.trim();
    }

    const guestId = nextDemoId('demo-collect');
    const nowIso = new Date().toISOString();
    const primarySplit = splitMemberFullName(payload.guestName.trim());
    const collectedMembers: HouseholdMemberDTO[] = [
      {
        id: `${guestId}-member-1`,
        invitationCodeId: guestId,
        fullName: payload.guestName.trim(),
        firstName: primarySplit.firstName,
        lastName: primarySplit.lastName,
        role: 'PRIMARY',
        email: payload.email?.trim() || null,
        phone: payload.phone?.trim() || null,
        dietaryNotes: payload.dietaryNotes?.trim() || null,
        tags: ['address-collection'],
        displayOrder: 0,
        seatNumber: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ];
    if (payload.partner && payload.partner.fullName.trim()) {
      const pSplit = splitMemberFullName(payload.partner.fullName.trim());
      collectedMembers.push({
        id: `${guestId}-member-2`,
        invitationCodeId: guestId,
        fullName: payload.partner.fullName.trim(),
        firstName: pSplit.firstName,
        lastName: pSplit.lastName,
        role: 'PARTNER',
        email: payload.partner.email?.trim() || null,
        phone: payload.partner.phone?.trim() || null,
        dietaryNotes: payload.partner.dietaryNotes?.trim() || null,
        tags: [],
        displayOrder: collectedMembers.length,
        seatNumber: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
    if (Array.isArray(payload.children)) {
      for (const child of payload.children) {
        if (!child.fullName.trim()) continue;
        const cSplit = splitMemberFullName(child.fullName.trim());
        collectedMembers.push({
          id: `${guestId}-member-${collectedMembers.length + 1}`,
          invitationCodeId: guestId,
          fullName: child.fullName.trim(),
          firstName: cSplit.firstName,
          lastName: cSplit.lastName,
          role: 'CHILD',
          email: null,
          phone: null,
          dietaryNotes: child.dietaryNotes?.trim() || null,
          tags: child.isKidsMeal !== false ? ['kids'] : [],
          displayOrder: collectedMembers.length,
          seatNumber: null,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
      }
    }

    const companionNames = collectedMembers.slice(1).map((m) => m.fullName);
    const extraFieldsWithMembers: Record<string, unknown> = {
      ...extraFields,
      ...(companionNames.length > 0 ? { plusOneNames: companionNames } : {}),
    };

    const createdGuest: InvitationCodeDTO = {
      id: guestId,
      code: uniqueCode,
      guestName: payload.guestName.trim(),
      email: payload.email?.trim() || null,
      addressLine1: payload.addressLine1 || null,
      addressLine2: payload.addressLine2 || null,
      city: payload.city || null,
      state: payload.state || null,
      zipCode: payload.zipCode || null,
      country: payload.country || null,
      householdName: payload.householdName || '',
      dietaryNotes: payload.dietaryNotes?.trim() || null,
      ...(Object.keys(extraFieldsWithMembers).length > 0
        ? { extraFields: extraFieldsWithMembers }
        : {}),
      partyGroup: '',
      partyTags: ['address-collection'],
      plusOneAllocations: Math.max(0, collectedMembers.length - 1),
      plusOneFirstName: collectedMembers[1]?.firstName ?? null,
      plusOneLastName: collectedMembers[1]?.lastName ?? null,
      members: collectedMembers,
      used: false,
      isSample: false,
    };

    mutateActiveDataset((current) => ({
      ...current,
      guests: [...current.guests, createdGuest],
    }));
    upsertInvitationsIntoStaticDemoStore([createdGuest]);
    recordDemoAuditVersion(
      'InvitationCode',
      createdGuest.id,
      'CREATE',
      `Public mailing address collected for ${createdGuest.guestName}`,
      createdGuest as unknown as Record<string, unknown>,
      'Guest Portal'
    );

    return jsonResponse({
      success: true,
      message: 'Address submitted successfully.',
    });
  }

  // 6. Authenticated Guest Mailing Address
  if (path === '/api/guest/address') {
    const session = getDemoState().guestSession;
    const guest = session ? findDemoGuestByCode(session.invitationCode) : null;
    if (!session || !guest) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }
    if (method === 'GET') {
      const members = buildDemoHouseholdMembersForGuest(guest);
      return jsonResponse({
        success: true,
        data: {
          guestName: guest.guestName || session.guestName,
          householdName: guest.householdName || '',
          code: activeGuestCode(guest, session.invitationCode),
          addressLine1: guest.addressLine1 || '',
          addressLine2: guest.addressLine2 || '',
          city: guest.city || '',
          state: guest.state || '',
          zipCode: guest.zipCode || '',
          country: guest.country || '',
          members,
        },
      });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const rawMembers = Array.isArray(body.members)
        ? body.members
          .filter((m): m is Record<string, unknown> => Boolean(m && typeof m === 'object'))
          .map((m) => ({
            ...(typeof m.id === 'string' ? { id: m.id } : {}),
            fullName: String(m.fullName ?? '').trim(),
            ...(typeof m.firstName === 'string' || m.firstName === null
              ? { firstName: m.firstName }
              : {}),
            ...(typeof m.lastName === 'string' || m.lastName === null
              ? { lastName: m.lastName }
              : {}),
            ...(m.role === 'PRIMARY' ||
              m.role === 'PARTNER' ||
              m.role === 'CHILD' ||
              m.role === 'PLUS_ONE'
              ? { role: m.role as HouseholdMemberRole }
              : {}),
            ...(typeof m.email === 'string' || m.email === null ? { email: m.email } : {}),
            ...(typeof m.phone === 'string' || m.phone === null ? { phone: m.phone } : {}),
            ...(typeof m.dietaryNotes === 'string' || m.dietaryNotes === null
              ? { dietaryNotes: m.dietaryNotes }
              : {}),
            ...(Array.isArray(m.tags) ? { tags: m.tags.map(String) } : {}),
          }))
          .filter((m) => m.fullName.length > 0)
        : undefined;
      if (Array.isArray(body.members) && (!rawMembers || rawMembers.length === 0)) {
        return jsonResponse(
          { success: false, error: 'At least one household member with a name is required.' },
          400
        );
      }
      const updated = updateDemoGuestAddress(session.invitationCode, {
        ...(typeof body.addressLine1 === 'string' ? { addressLine1: body.addressLine1 } : {}),
        ...(typeof body.addressLine2 === 'string' ? { addressLine2: body.addressLine2 } : {}),
        ...(typeof body.city === 'string' ? { city: body.city } : {}),
        ...(typeof body.state === 'string' ? { state: body.state } : {}),
        ...(typeof body.zipCode === 'string' ? { zipCode: body.zipCode } : {}),
        ...(typeof body.country === 'string' ? { country: body.country } : {}),
        ...(typeof body.householdName === 'string' ? { householdName: body.householdName } : {}),
        ...(rawMembers ? { members: rawMembers } : {}),
      });
      if (updated) {
        upsertInvitationsIntoStaticDemoStore([updated]);
      }
      const members = updated ? buildDemoHouseholdMembersForGuest(updated) : [];
      return jsonResponse({
        success: true,
        data: {
          guestName: updated?.guestName || session.guestName,
          householdName: updated?.householdName || '',
          code: activeGuestCode(updated, session.invitationCode),
          addressLine1: updated?.addressLine1 || '',
          addressLine2: updated?.addressLine2 || '',
          city: updated?.city || '',
          state: updated?.state || '',
          zipCode: updated?.zipCode || '',
          country: updated?.country || '',
          members,
        },
      });
    }
  }

  // 7. Schedule & ICS Calendar Download
  if (path === '/api/schedule' && method === 'GET') {
    const session = getDemoState().guestSession;
    const settings = getEffectiveDemoSettings();
    const cutoff = evaluateRsvpCutoff({
      rsvpOpen: Boolean(settings.rsvpOpen),
      rsvpDeadlineDate:
        typeof settings.rsvpDeadlineDate === 'string' ? settings.rsvpDeadlineDate : null,
      rsvpGracePeriodHours: Number(settings.rsvpGracePeriodHours ?? 0),
      rsvpClosedMessage:
        typeof settings.rsvpClosedMessage === 'string'
          ? settings.rsvpClosedMessage
          : DEFAULT_RSVP_CLOSED_MESSAGE,
      timezone: typeof settings.timezone === 'string' ? settings.timezone : 'America/Chicago',
    });

    const matchedGuest = session ? findDemoGuestByCode(session.invitationCode) : null;
    const dataset = getActiveArchetypeDataset();
    const savedPlusOneNames = matchedGuest
      ? Array.from(
        new Set(
          dataset.subEventRsvps
            .filter((r) => r.invitationCodeId === matchedGuest.id)
            .flatMap((r) => r.plusOneNames || [])
            .filter(Boolean)
        )
      )
      : [];

    const schedule = buildScheduleForGuest(matchedGuest?.code ?? null);
    const householdMembers = matchedGuest ? buildDemoHouseholdMembersForGuest(matchedGuest) : [];

    return jsonResponse({
      success: true,
      data: schedule,
      isGuest: Boolean(matchedGuest),
      guestName: matchedGuest?.guestName ?? null,
      householdName: matchedGuest?.householdName ?? null,
      householdMembers,
      plusOneAllocations: matchedGuest ? Math.max(0, matchedGuest.plusOneAllocations ?? 0) : null,
      savedPlusOneNames,
      rsvpOpen: cutoff.isOpen,
      rsvpDeadlineDate: cutoff.deadlineDate,
      rsvpFormattedDeadline: cutoff.formattedDeadline,
      timezone: cutoff.timezone,
      rsvpClosedMessage: cutoff.closedMessage,
    });
  }

  const scheduleIcsMatch = path.match(/^\/api\/schedule\/([^/]+)\/ics$/);
  if (scheduleIcsMatch && method === 'GET') {
    const eventId = decodeURIComponent(scheduleIcsMatch[1]);
    const dataset = getActiveArchetypeDataset();
    const state = getDemoState();
    const settings = getEffectiveDemoSettings(state);
    const datasetEvent = dataset.subEvents.find((evt) => evt.id === eventId);
    const seededEvent = datasetEvent
      ? null
      : buildArchetypeSeedData(state.archetype).subEvents.find((ev) => ev.id === eventId) ?? null;

    if (!datasetEvent && !seededEvent) {
      return jsonResponse({ success: false, error: 'Schedule event not found.' }, 404);
    }

    const title = datasetEvent?.title ?? seededEvent!.title;
    const rawStart = datasetEvent?.startTime ?? seededEvent?.startTime;
    const startTime =
      rawStart instanceof Date
        ? rawStart.toISOString()
        : typeof rawStart === 'string' && rawStart
          ? rawStart
          : undefined;
    const rawEnd = datasetEvent?.endTime ?? seededEvent?.endTime;
    const endTime =
      rawEnd instanceof Date
        ? rawEnd.toISOString()
        : typeof rawEnd === 'string' && rawEnd
          ? rawEnd
          : undefined;
    const locationName = datasetEvent?.locationName ?? seededEvent!.locationName;
    const location = datasetEvent?.location ?? seededEvent!.location;
    const attireRules =
      (datasetEvent && 'attireRules' in datasetEvent && typeof datasetEvent.attireRules === 'string'
        ? datasetEvent.attireRules
        : undefined) ??
      seededEvent?.attireRules ??
      undefined;
    const description = datasetEvent?.description ?? seededEvent?.description ?? '';

    const calendarEvent = formatScheduleEventToCalendarEvent(
      {
        id: eventId,
        title,
        startTime,
        endTime,
        locationName: locationName || undefined,
        location: location || undefined,
        attireRules: attireRules || undefined,
        description: description || undefined,
      },
      undefined,
      typeof settings.timezone === 'string' ? settings.timezone : 'UTC'
    );
    const icsContent =
      createIcsFile(calendarEvent) ||
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Wedding Showcase Demo//EN',
        'BEGIN:VEVENT',
        `UID:${eventId}@wedding-showcase.demo`,
        `SUMMARY:${title.replace(/[\r\n]+/g, ' ')}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n');
    const cleanFilename = `${(title || eventId).replace(/["\r\n\t]/g, '').trim() || eventId}.ics`;
    return binaryResponse(icsContent, 'text/calendar; charset=utf-8', cleanFilename);
  }

  const scheduleDetailMatch = path.match(/^\/api\/schedule\/([^/]+)$/);
  if (scheduleDetailMatch && method === 'GET') {
    const eventId = decodeURIComponent(scheduleDetailMatch[1]);
    const session = getDemoState().guestSession;
    const dataset = getActiveArchetypeDataset();
    const rawEvent = dataset.subEvents.find((evt) => evt.id === eventId);
    if (!rawEvent) {
      return jsonResponse({ success: false, error: 'Sub-event not found.' }, 404);
    }
    const schedule = buildScheduleForGuest(session?.invitationCode ?? null);
    const accessible = schedule.find((evt) => evt.id === eventId);
    if (!accessible) {
      return jsonResponse(
        { success: false, error: `Forbidden: You do not have access to "${rawEvent.title}".` },
        403
      );
    }
    return jsonResponse({ success: true, data: accessible });
  }

  // 8. Guest RSVP Submission
  if (path === '/api/rsvp' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const session = getDemoState().guestSession;
    const explicitCode = typeof body.code === 'string' ? body.code.trim() : '';
    const activeCode = explicitCode || session?.invitationCode || '';
    const guest = activeCode ? findDemoGuestByCode(activeCode) : null;

    if (!guest) {
      return jsonResponse(
        {
          success: false,
          error: 'Unauthorized: Please log in with your invitation code to submit RSVPs.',
        },
        401
      );
    }

    const settings = getEffectiveDemoSettings();
    const cutoff = evaluateRsvpCutoff({
      rsvpOpen: Boolean(settings.rsvpOpen),
      rsvpDeadlineDate:
        typeof settings.rsvpDeadlineDate === 'string' ? settings.rsvpDeadlineDate : null,
      rsvpGracePeriodHours: Number(settings.rsvpGracePeriodHours ?? 0),
      rsvpClosedMessage:
        typeof settings.rsvpClosedMessage === 'string'
          ? settings.rsvpClosedMessage
          : DEFAULT_RSVP_CLOSED_MESSAGE,
      timezone: typeof settings.timezone === 'string' ? settings.timezone : 'America/Chicago',
    });
    if (!cutoff.isOpen) {
      return jsonResponse({ success: false, error: cutoff.closedMessage }, 403);
    }

    const rawArray = Array.isArray(body.rsvps)
      ? body.rsvps
      : Array.isArray(body.responses)
        ? body.responses
        : null;
    const rawSubmissions: Array<Record<string, unknown>> = rawArray
      ? rawArray.filter((r): r is Record<string, unknown> => Boolean(r && typeof r === 'object'))
      : typeof body.subEventId === 'string'
        ? [body]
        : [];

    if (rawSubmissions.length === 0) {
      return jsonResponse(
        {
          success: false,
          error: 'Invalid RSVP payload format. Expected { subEventId, status } or { rsvps: [...] }.',
        },
        400
      );
    }

    for (const sub of rawSubmissions) {
      const hasMemberRsvps = Array.isArray(sub.memberRsvps) && sub.memberRsvps.length > 0;
      const rawStatus = typeof sub.status === 'string' ? sub.status.trim().toLowerCase() : '';
      if (!hasMemberRsvps && rawStatus !== 'attending' && rawStatus !== 'declined') {
        return jsonResponse(
          { success: false, error: 'Please select Attending or Declined.' },
          400
        );
      }
    }

    const nowIso = new Date().toISOString();
    const updatedClientRsvps: Array<Record<string, unknown>> = [];

    mutateActiveDataset((current) => {
      const nextRsvps = [...current.subEventRsvps];
      let nextGuestDietary: string | null = guest.dietaryNotes ?? null;
      const guestMembers = buildDemoHouseholdMembersForGuest(guest);
      const memberById = new Map(guestMembers.map((m) => [m.id, m]));

      for (const sub of rawSubmissions) {
        const subEventId = String(sub.subEventId ?? '').trim();
        if (!subEventId) continue;

        const existingIdx = nextRsvps.findIndex(
          (r) => r.subEventId === subEventId && r.invitationCodeId === guest.id
        );
        const rsvpId = existingIdx >= 0 ? nextRsvps[existingIdx].id : nextDemoId('demo-rsvp');

        let storedStatus: 'ATTENDING' | 'DECLINED';
        let plusOneCount: number;
        let mealSelections: string[];
        let plusOneNames: string[];
        let memberRsvps: DemoSubEventMemberRsvpRecord[];

        if (Array.isArray(sub.memberRsvps) && sub.memberRsvps.length > 0) {
          const parsedMr = (sub.memberRsvps as Array<Record<string, unknown>>)
            .filter((mr) => typeof mr.householdMemberId === 'string')
            .map((mr, mIdx): DemoSubEventMemberRsvpRecord => {
              const rawSt = String(mr.status ?? 'pending').trim().toLowerCase();
              const st: 'attending' | 'declined' | 'pending' =
                rawSt === 'attending'
                  ? 'attending'
                  : rawSt === 'declined'
                    ? 'declined'
                    : 'pending';
              return {
                id: `${rsvpId}-mr-${mIdx + 1}`,
                subEventRsvpId: rsvpId,
                householdMemberId: String(mr.householdMemberId),
                status: st,
                mealOptionId:
                  st === 'attending' && typeof mr.mealOptionId === 'string' && mr.mealOptionId
                    ? mr.mealOptionId
                    : null,
                dietaryNotes:
                  st !== 'declined' && typeof mr.dietaryNotes === 'string' && mr.dietaryNotes.trim()
                    ? mr.dietaryNotes.trim()
                    : null,
              };
            });
          memberRsvps = parsedMr;
          const attendingMembers = parsedMr.filter((mr) => mr.status === 'attending');
          storedStatus = attendingMembers.length > 0 ? 'ATTENDING' : 'DECLINED';
          plusOneCount =
            storedStatus === 'ATTENDING' ? Math.max(0, attendingMembers.length - 1) : 0;
          mealSelections = attendingMembers
            .map((mr) => mr.mealOptionId)
            .filter((id): id is string => Boolean(id));
          plusOneNames = attendingMembers
            .map((mr) => memberById.get(mr.householdMemberId))
            .filter((m): m is HouseholdMemberDTO => Boolean(m && m.role !== 'PRIMARY'))
            .map((m) => m.fullName);
        } else {
          const rawStatus = String(sub.status ?? 'attending').trim().toLowerCase();
          storedStatus = rawStatus === 'declined' ? 'DECLINED' : 'ATTENDING';
          const isDeclined = storedStatus === 'DECLINED';
          plusOneCount = isDeclined
            ? 0
            : Math.min(10, Math.max(0, Math.floor(Number(sub.plusOneCount ?? 0) || 0)));
          mealSelections = isDeclined
            ? []
            : Array.isArray(sub.mealSelections)
              ? normalizeMealSelections(sub.mealSelections)
              : typeof sub.mealSelection === 'string' && sub.mealSelection
                ? [sub.mealSelection]
                : [];
          plusOneNames = isDeclined ? [] : normalizePlusOneNames(sub.plusOneNames);
          const cap = isDeclined ? 0 : 1 + plusOneCount;
          memberRsvps = guestMembers.map((m, mIdx) => {
            const st: 'attending' | 'declined' = mIdx < cap ? 'attending' : 'declined';
            return {
              id: `${rsvpId}-mr-${mIdx + 1}`,
              subEventRsvpId: rsvpId,
              householdMemberId: m.id,
              status: st,
              mealOptionId: st === 'attending' ? (mealSelections[mIdx] ?? null) : null,
              dietaryNotes: st === 'attending' ? (m.dietaryNotes ?? null) : null,
            };
          });
        }

        const isDeclined = storedStatus === 'DECLINED';
        const customAnswers = isDeclined ? {} : normalizeCustomAnswers(sub.customAnswers);

        const existingEventNote =
          existingIdx >= 0 ? (nextRsvps[existingIdx].dietaryNotes || '').trim() : '';
        const incomingDietary =
          typeof sub.dietaryNotes === 'string' ? sub.dietaryNotes.trim() : '';
        const explicitClear =
          sub.clearDietaryNotes === true ||
          (!isDeclined &&
            typeof sub.dietaryNotes === 'string' &&
            incomingDietary === '' &&
            Boolean(existingEventNote));
        const resolvedDietary = explicitClear
          ? ''
          : incomingDietary || existingEventNote || (guest.dietaryNotes || '').trim();

        if (explicitClear) {
          nextGuestDietary = '';
        } else if (incomingDietary) {
          nextGuestDietary = incomingDietary;
        }

        const record: DemoSubEventRsvpRecord = {
          id: rsvpId,
          subEventId,
          invitationCodeId: guest.id,
          guestCode: guest.code,
          guestName: guest.guestName,
          status: storedStatus,
          plusOneCount,
          plusOneNames,
          mealSelection: mealSelections[0] ?? null,
          mealSelections,
          dietaryNotes: resolvedDietary,
          customAnswers,
          memberRsvps,
          respondedAt: existingIdx >= 0 ? nextRsvps[existingIdx].respondedAt : nowIso,
          updatedAt: nowIso,
        };

        if (existingIdx >= 0) {
          nextRsvps[existingIdx] = record;
        } else {
          nextRsvps.push(record);
        }

        updatedClientRsvps.push({
          id: record.id,
          subEventId: record.subEventId,
          invitationCodeId: record.invitationCodeId,
          status: toClientRsvpStatus(record.status),
          plusOneCount: record.plusOneCount,
          plusOneNames: record.plusOneNames,
          mealSelections: record.mealSelections,
          dietaryNotes: record.dietaryNotes,
          customAnswers: record.customAnswers,
          memberRsvps: record.memberRsvps ?? [],
          updatedAt: record.updatedAt,
        });
      }

      const guestRsvps = nextRsvps.filter((r) => r.invitationCodeId === guest.id);
      const overallStatus = guestRsvps.some((r) => r.status === 'ATTENDING')
        ? 'attending'
        : guestRsvps.length > 0 && guestRsvps.every((r) => r.status === 'DECLINED')
          ? 'declined'
          : 'pending';
      const maxConfirmedPlusOnes = guestRsvps.reduce(
        (max, r) => (r.status === 'ATTENDING' ? Math.max(max, r.plusOneCount) : max),
        0
      );

      const nextGuests = current.guests.map((g) => {
        if (g.id !== guest.id) return g;
        const existingExtra =
          g.extraFields && typeof g.extraFields === 'object' ? { ...g.extraFields } : {};
        return {
          ...g,
          used: overallStatus !== 'pending',
          dietaryNotes: nextGuestDietary,
          extraFields: {
            ...existingExtra,
            rsvpStatus: overallStatus,
            attendanceStatus: overallStatus,
            plusOneCount: overallStatus === 'declined' ? 0 : maxConfirmedPlusOnes,
          },
        };
      });

      return {
        ...current,
        guests: nextGuests,
        subEventRsvps: nextRsvps,
      };
    });

    recordDemoAuditVersion(
      'SubEventRsvp',
      guest.id,
      'RSVP_SUBMIT',
      `Guest ${guest.guestName} submitted ${updatedClientRsvps.length} RSVP response(s)`,
      { guestCode: guest.code, rsvps: updatedClientRsvps },
      guest.guestName
    );

    return jsonResponse({
      success: true,
      data: updatedClientRsvps,
    });
  }

  return null;
}

function activeGuestCode(guest: InvitationCodeDTO | null | undefined, fallback: string): string {
  return guest?.code || fallback;
}
