import { z } from 'zod';
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
  STATE_MAX_LENGTH,
  ZIP_CODE_MAX_LENGTH,
} from '@/utils/invitationValidation';
import type { InvitationCodeDTO } from '@/features/registry';
import type { DemoSubEventRsvpRecord } from '../demoSeed';
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
});

function toClientRsvpStatus(
  status: string | undefined | null
): 'attending' | 'declined' | 'pending' {
  const normalized = String(status ?? 'pending').trim().toLowerCase();
  if (normalized === 'attending') return 'attending';
  if (normalized === 'declined') return 'declined';
  return 'pending';
}

function toStoredRsvpStatus(
  status: string | undefined | null
): 'ATTENDING' | 'DECLINED' | 'PENDING' {
  const normalized = String(status ?? 'PENDING').trim().toUpperCase();
  if (normalized === 'ATTENDING') return 'ATTENDING';
  if (normalized === 'DECLINED') return 'DECLINED';
  return 'PENDING';
}

function formatIcsTimestamp(raw: string | Date | null | undefined, fallbackIso: string): string {
  const parsed = raw ? new Date(raw) : new Date(fallbackIso);
  const valid = Number.isNaN(parsed.getTime()) ? new Date(fallbackIso) : parsed;
  return valid.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function buildScheduleForGuest(invitationCode?: string | null) {
  const dataset = getActiveArchetypeDataset();
  const normalizedCode = typeof invitationCode === 'string' ? invitationCode.trim() : '';
  const matchedGuest = normalizedCode ? findDemoGuestByCode(normalizedCode) : null;

  const accessibleSubEvents = dataset.subEvents.filter((evt) => {
    if (!evt.isPrivate) return true;
    if (!matchedGuest) return false;
    return dataset.subEventAccess.some(
      (acc) => acc.subEventId === evt.id && acc.invitationCodeId === matchedGuest.id
    );
  });

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
      attireRules: null,
      mealOptions: normalizeMealOptions(evt.mealOptions),
      customQuestions: normalizeCustomQuestions(evt.customQuestions),
      userRsvp: rsvp
        ? {
          status: toClientRsvpStatus(rsvp.status),
          plusOneCount: rsvp.plusOneCount ?? 0,
          dietaryNotes: rsvp.dietaryNotes || '',
          mealSelections: normalizeMealSelections(rsvp.mealSelections),
          customAnswers: normalizeCustomAnswers(rsvp.customAnswers),
          plusOneNames: normalizePlusOneNames(rsvp.plusOneNames),
        }
        : null,
    };
  });
}

export async function handleGuestRoutes(ctx: DemoRouteContext): Promise<Response | null> {
  const { path, method, init, rawInput } = ctx;

  // 1. Guest Login & Passcode / Invite Session
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

  // 2. Guest Invitation Lookup (by name, email, or household)
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
    const matched = candidates.find((g) => {
      if (rawEmail && g.email && g.email.trim().toLowerCase() === rawEmail) {
        return true;
      }
      if (rawName) {
        const guestName = g.guestName.toLowerCase();
        const householdName = (g.householdName || '').toLowerCase();
        if (guestName.includes(rawName) || householdName.includes(rawName)) {
          return true;
        }
      }
      return false;
    });

    if (!matched) {
      return jsonResponse(
        {
          success: false,
          error: 'No matching invitation was found. Please check your spelling or contact the couple.',
        },
        404
      );
    }

    const payload = {
      found: true,
      code: matched.code,
      guestName: matched.guestName,
      householdName: matched.householdName ?? '',
    };
    return jsonResponse({
      success: true,
      ...payload,
      data: payload,
    });
  }

  // 3. Guest Logout
  if (path === '/api/guest/logout' && method === 'POST') {
    setDemoGuestSession(null);
    return jsonResponse({ success: true, data: { success: true } });
  }

  // 4. Public Address Collection
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

    const createdGuest: InvitationCodeDTO = {
      id: nextDemoId('demo-collect'),
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
      dietaryNotes: null,
      ...(Object.keys(extraFields).length > 0 ? { extraFields } : {}),
      partyGroup: '',
      partyTags: ['address-collection'],
      plusOneAllocations: 0,
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

  // 5. Authenticated Guest Mailing Address
  if (path === '/api/guest/address') {
    const session = getDemoState().guestSession;
    if (!session) {
      return jsonResponse({ success: false, error: 'Authentication required.' }, 401);
    }
    const guest = findDemoGuestByCode(session.invitationCode);
    if (method === 'GET') {
      return jsonResponse({
        success: true,
        data: {
          guestName: guest?.guestName || session.guestName,
          code: session.invitationCode,
          addressLine1: guest?.addressLine1 || '',
          addressLine2: guest?.addressLine2 || '',
          city: guest?.city || '',
          state: guest?.state || '',
          zipCode: guest?.zipCode || '',
          country: guest?.country || '',
        },
      });
    }
    if (method === 'PUT' || method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const updated = updateDemoGuestAddress(session.invitationCode, {
        addressLine1: typeof body.addressLine1 === 'string' ? body.addressLine1 : '',
        addressLine2: typeof body.addressLine2 === 'string' ? body.addressLine2 : '',
        city: typeof body.city === 'string' ? body.city : '',
        state: typeof body.state === 'string' ? body.state : '',
        zipCode: typeof body.zipCode === 'string' ? body.zipCode : '',
        country: typeof body.country === 'string' ? body.country : '',
      });
      return jsonResponse({
        success: true,
        data: {
          guestName: updated?.guestName || session.guestName,
          code: session.invitationCode,
          addressLine1: updated?.addressLine1 || '',
          addressLine2: updated?.addressLine2 || '',
          city: updated?.city || '',
          state: updated?.state || '',
          zipCode: updated?.zipCode || '',
          country: updated?.country || '',
        },
      });
    }
  }

  // 6. Schedule & ICS Calendar Download
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

    const schedule = buildScheduleForGuest(session?.invitationCode ?? null);

    return jsonResponse({
      success: true,
      data: schedule,
      isGuest: Boolean(matchedGuest),
      guestName: matchedGuest?.guestName ?? session?.guestName ?? null,
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
    const session = getDemoState().guestSession;
    const schedule = buildScheduleForGuest(session?.invitationCode ?? null);
    const target = schedule.find((evt) => evt.id === eventId);
    if (!target) {
      return jsonResponse({ success: false, error: 'Schedule event not found.' }, 404);
    }
    const dtStart = formatIcsTimestamp(target.startTime, '2026-09-19T21:00:00.000Z');
    const dtEnd = formatIcsTimestamp(target.endTime, '2026-09-19T23:00:00.000Z');
    const dtStamp = formatIcsTimestamp(new Date(), '2026-01-15T12:00:00.000Z');
    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Wedding Showcase Demo//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:${target.id}@wedding-showcase.demo`,
      `DTSTAMP:${dtStamp}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${target.title.replace(/[\r\n]+/g, ' ')}`,
      `DESCRIPTION:${(target.description || '').replace(/[\r\n]+/g, ' ')}`,
      `LOCATION:${[target.locationName, target.location].filter(Boolean).join(', ').replace(/[\r\n]+/g, ' ')}`,
      'END:VEVENT',
      'END:VCALENDAR',
      '',
    ].join('\r\n');
    return binaryResponse(ics, 'text/calendar; charset=utf-8', `${target.id}.ics`);
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

  // 7. Guest RSVP Submission
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

    const maxAllowedPlusOnes = Math.max(0, guest.plusOneAllocations ?? 0);
    for (const sub of rawSubmissions) {
      const requestedPlusOnes = Math.max(0, Number(sub.plusOneCount ?? 0) || 0);
      if (toStoredRsvpStatus(String(sub.status ?? '')) === 'ATTENDING' && requestedPlusOnes > maxAllowedPlusOnes) {
        return jsonResponse(
          {
            success: false,
            error: `Plus-one count (${requestedPlusOnes}) exceeds your allocated limit of ${maxAllowedPlusOnes}.`,
          },
          400
        );
      }
    }

    const nowIso = new Date().toISOString();
    const updatedClientRsvps: Array<Record<string, unknown>> = [];

    mutateActiveDataset((current) => {
      const nextRsvps = [...current.subEventRsvps];
      let latestDietary = guest.dietaryNotes ?? null;

      for (const sub of rawSubmissions) {
        const subEventId = String(sub.subEventId ?? '').trim();
        if (!subEventId) continue;
        const storedStatus = toStoredRsvpStatus(String(sub.status ?? 'attending'));
        const plusOneCount =
          storedStatus === 'DECLINED' ? 0 : Math.max(0, Number(sub.plusOneCount ?? 0) || 0);
        const mealSelections = Array.isArray(sub.mealSelections)
          ? sub.mealSelections.map(String)
          : typeof sub.mealSelection === 'string' && sub.mealSelection
            ? [sub.mealSelection]
            : [];
        const plusOneNames = Array.isArray(sub.plusOneNames) ? sub.plusOneNames.map(String) : [];
        const dietaryNotes = typeof sub.dietaryNotes === 'string' ? sub.dietaryNotes.trim() : '';
        if (dietaryNotes) {
          latestDietary = dietaryNotes;
        }
        const customAnswers =
          sub.customAnswers && typeof sub.customAnswers === 'object' && !Array.isArray(sub.customAnswers)
            ? Object.fromEntries(
              Object.entries(sub.customAnswers as Record<string, unknown>).map(([k, v]) => [
                k,
                String(v ?? ''),
              ])
            )
            : {};

        const existingIdx = nextRsvps.findIndex(
          (r) => r.subEventId === subEventId && r.invitationCodeId === guest.id
        );
        const record: DemoSubEventRsvpRecord = {
          id: existingIdx >= 0 ? nextRsvps[existingIdx].id : nextDemoId('demo-rsvp'),
          subEventId,
          invitationCodeId: guest.id,
          guestCode: guest.code,
          guestName: guest.guestName,
          status: storedStatus,
          plusOneCount,
          plusOneNames,
          mealSelection: mealSelections[0] ?? null,
          mealSelections,
          dietaryNotes,
          customAnswers,
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
          updatedAt: record.updatedAt,
        });
      }

      const guestRsvps = nextRsvps.filter((r) => r.invitationCodeId === guest.id);
      const overallStatus = guestRsvps.some((r) => r.status === 'ATTENDING')
        ? 'attending'
        : guestRsvps.length > 0 && guestRsvps.every((r) => r.status === 'DECLINED')
          ? 'declined'
          : 'pending';

      const nextGuests = current.guests.map((g) => {
        if (g.id !== guest.id) return g;
        const existingExtra =
          g.extraFields && typeof g.extraFields === 'object' ? { ...g.extraFields } : {};
        return {
          ...g,
          used: overallStatus !== 'pending',
          dietaryNotes: latestDietary,
          extraFields: {
            ...existingExtra,
            rsvpStatus: overallStatus,
            attendanceStatus: overallStatus,
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
