import type {
  DemoContentNodeRecord,
  DemoHouseholdMemberRecord,
  DemoHouseholdRole,
  DemoInvitationCodeRecord,
  DemoRsvpStatus,
  DemoSubEventMemberRsvpRecord,
  DemoSubEventRsvpRecord,
  NormalizedDemoRequest,
  StaticDemoSnapshot,
  StaticDemoStore,
} from '../types';
import {
  binaryResponse,
  errorJson,
  generateDemoId,
  readJsonBody,
  wrapMiddlewareJson,
} from '../responseHelpers';
import {
  getActiveAppConfig,
  getOrderedDemoHouseholdMembers,
  pushAuditVersion,
  toAdminConfigDto,
  toPhotoDto,
} from '../dtoMappers';
import { buildSubEventIcs } from '../exporters';
import { synthesizeDemoHouseholdMembersFromInvitations } from '../seeds';
import { createCompactUploadThumbnail, createDemoSvgDataUrl } from '../svgAssets';
import { normalizePartyTags, splitMemberFullName } from '@/utils/invitationValidation';
import {
  extractVenueDateAndTime,
  subtractCalendarDays,
} from '@/utils/venueDateTime';
import {
  RECOVERY_CONFIRMATION_MESSAGE,
  findUnambiguousRecoverableInvitation,
  hasRecoveryHoneypotTripped,
  isEmailProviderActive,
  isHouseholdOnRecoveryCooldown,
  isSmsProviderActive,
  markHouseholdRecoverySent,
  parseRecoveryIdentifier,
} from '@/utils/guestSignInRecovery';
import type { CustomRsvpQuestionDTO, MealOptionDTO } from '@/utils/rsvpPrompts';

function hasUnpromotedAddressCollectionTag(partyTags: unknown): boolean {
  return normalizePartyTags(partyTags).includes('address-collection');
}

function resolveActiveInvitation(
  snapshot: StaticDemoSnapshot,
): DemoInvitationCodeRecord | null {
  if (snapshot.guestSession?.code) {
    const exact = snapshot.invitationCode.find(
      (inv) => inv.code.toUpperCase() === snapshot.guestSession?.code.toUpperCase(),
    );
    if (exact) {
      return hasUnpromotedAddressCollectionTag(exact.partyTags) ? null : exact;
    }
  }
  return (
    snapshot.invitationCode.find(
      (inv) => !inv.isSample && !hasUnpromotedAddressCollectionTag(inv.partyTags),
    ) ??
    snapshot.invitationCode.find(
      (inv) => !hasUnpromotedAddressCollectionTag(inv.partyTags),
    ) ??
    null
  );
}

function buildClimateForecast(
  latitude: number,
  weddingDateIso: string,
  timezone?: string,
) {
  const dayStr =
    extractVenueDateAndTime(weddingDateIso, timezone || 'UTC').date ||
    '2026-09-19';
  const availStr = subtractCalendarDays(dayStr, 16);
  const absLat = Math.abs(Number.isFinite(latitude) ? latitude : 40.7128);
  const high = absLat < 24 ? 84 : absLat < 45 ? 75 : 68;
  const low = absLat < 24 ? 71 : absLat < 45 ? 57 : 50;

  return {
    isLiveForecast: false,
    liveForecastAvailableDate: availStr,
    daily: {
      time: [dayStr],
      weathercode: [1],
      temperature_2m_max: [high],
      temperature_2m_min: [low],
      apparent_temperature_max: [high - 2],
      precipitation_probability_max: [15],
      wind_speed_10m_max: [8],
    },
  };
}

function decodeDataUrlSvgMarkup(dataUrl: string): string {
  const prefix = 'data:image/svg+xml;base64,';
  if (!dataUrl.startsWith(prefix)) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"></svg>';
  }
  const b64 = dataUrl.slice(prefix.length);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  return atob(b64);
}

function generateRandomInviteCode(existingCodes: Set<string>): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 25; attempt += 1) {
    let code = '';
    for (let i = 0; i < 8; i += 1) {
      code += chars[(attempt * 7 + i * 13 + existingCodes.size) % chars.length];
    }
    if (!existingCodes.has(code)) {
      return code;
    }
  }
  return `GUEST${Date.now().toString(36).slice(-4).toUpperCase()}`;
}

export async function handlePublicRoutes(
  req: NormalizedDemoRequest,
  store: StaticDemoStore,
): Promise<Response | null> {
  const { method, pathname, searchParams, request } = req;

  if (pathname === '/api/health' && method === 'GET') {
    return wrapMiddlewareJson(
      {
        status: 'ok',
        timestamp: new Date().toISOString(),
        database: 'connected',
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  }

  if (pathname === '/api/live' && method === 'GET') {
    return new Response(
      JSON.stringify({
        status: 'alive',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (pathname === '/api/ready' && method === 'GET') {
    return new Response(
      JSON.stringify({
        status: 'ready',
        database: 'connected',
        timestamp: new Date().toISOString(),
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      },
    );
  }

  if (pathname === '/api/weather' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    return wrapMiddlewareJson(
      buildClimateForecast(config.latitude, config.weddingDate, config.timezone),
    );
  }

  if (pathname === '/api/og' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    const title =
      searchParams.get('title') ||
      `${config.partner1Name} & ${config.partner2Name}`;
    const subtitle = searchParams.get('subtitle') || config.venueName;
    const svg = decodeDataUrlSvgMarkup(
      createDemoSvgDataUrl(title, subtitle, snapshot.activeArchetype),
    );
    return binaryResponse(svg, 'image/svg+xml; charset=utf-8');
  }

  if (pathname.startsWith('/api/uploads/') && method === 'GET') {
    const snapshot = store.getSnapshot();
    const segment = pathname.slice('/api/uploads/'.length);
    const svg = decodeDataUrlSvgMarkup(
      createDemoSvgDataUrl(segment || 'Asset', 'Media', snapshot.activeArchetype),
    );
    return binaryResponse(svg, 'image/svg+xml; charset=utf-8');
  }

  if (pathname === '/api/schedule' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    const activeInvite = resolveActiveInvitation(snapshot);
    const sortedEvents = [...snapshot.subEvent].sort((a, b) =>
      (a.startTime ?? '').localeCompare(b.startTime ?? ''),
    );

    const visibleEvents = sortedEvents.filter((event) => {
      if (!event.isPrivate) return true;
      if (!activeInvite) return false;
      return snapshot.subEventAccess.some(
        (acc) =>
          acc.subEventId === event.id && acc.invitationCodeId === activeInvite.id,
      );
    });

    const householdMembers = activeInvite
      ? getOrderedDemoHouseholdMembers(snapshot, activeInvite)
      : [];
    const memberById = new Map(householdMembers.map((m) => [m.id, m]));

    const eventsWithRsvp = visibleEvents.map((event) => {
      const existingRsvp = activeInvite
        ? snapshot.subEventRsvp.find(
          (r) =>
            r.subEventId === event.id && r.invitationCodeId === activeInvite.id,
        )
        : null;
      const mealOptions: MealOptionDTO[] = Array.isArray(event.mealOptions)
        ? event.mealOptions
        : [];
      const customQuestions: CustomRsvpQuestionDTO[] = Array.isArray(
        event.customQuestions,
      )
        ? event.customQuestions
        : [];
      const memberRsvps = existingRsvp
        ? (snapshot.subEventMemberRsvp ?? [])
          .filter((mr) => mr.subEventRsvpId === existingRsvp.id)
          .map((mr) => ({
            ...mr,
            member: memberById.get(mr.householdMemberId) ?? undefined,
          }))
        : [];

      return {
        ...event,
        mealOptions,
        customQuestions,
        userRsvp: existingRsvp
          ? {
            status: existingRsvp.status,
            plusOneCount: existingRsvp.plusOneCount,
            dietaryNotes: existingRsvp.dietaryNotes ?? '',
            mealSelections: existingRsvp.mealSelections ?? [],
            customAnswers: existingRsvp.customAnswers ?? {},
            plusOneNames: existingRsvp.plusOneNames ?? [],
            memberRsvps,
          }
          : {
            status: 'pending',
            plusOneCount: 0,
            dietaryNotes: activeInvite?.dietaryNotes ?? '',
            mealSelections: [],
            customAnswers: {},
            plusOneNames: [],
            memberRsvps: [],
          },
      };
    });

    const secondaryMemberNames = householdMembers
      .filter((m) => m.role !== 'PRIMARY')
      .map((m) => m.fullName.trim())
      .filter(Boolean);
    const savedPlusOneNames =
      secondaryMemberNames.length > 0
        ? secondaryMemberNames
        : activeInvite?.plusOneFirstName || activeInvite?.plusOneLastName
          ? [
            [activeInvite.plusOneFirstName, activeInvite.plusOneLastName]
              .filter(Boolean)
              .join(' '),
          ]
          : [];

    return wrapMiddlewareJson({
      success: true,
      data: eventsWithRsvp,
      isGuest: Boolean(snapshot.guestSession || activeInvite),
      guestName: activeInvite?.guestName ?? 'Alex & Jordan',
      householdName: activeInvite?.householdName ?? '',
      householdMembers,
      plusOneAllocations: activeInvite?.plusOneAllocations ?? 2,
      savedPlusOneNames,
      rsvpOpen: config.rsvpOpen !== false,
      rsvpDeadlineDate: config.rsvpDeadlineDate || null,
      rsvpFormattedDeadline: config.rsvpDeadlineDate
        ? config.rsvpDeadlineDate.slice(0, 10)
        : null,
      timezone: config.timezone || 'America/Chicago',
      rsvpClosedMessage:
        config.rsvpClosedMessage ||
        'Online RSVPs are now closed. Please contact the hosts directly if your plans or dietary needs have changed.',
    });
  }

  const icsMatch = pathname.match(/^\/api\/schedule\/([^/]+)\/ics$/);
  if (icsMatch && method === 'GET') {
    const eventId = decodeURIComponent(icsMatch[1]);
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    const subEvent = snapshot.subEvent.find((e) => e.id === eventId);
    if (!subEvent) {
      return errorJson(404, 'Schedule event not found');
    }
    const { filename, content } = buildSubEventIcs(subEvent, config);
    return binaryResponse(content, 'text/calendar; charset=utf-8', {
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
  }

  if (pathname === '/api/rsvp' && method === 'POST') {
    const body = await readJsonBody(request);
    const rawList = Array.isArray(body.rsvps)
      ? body.rsvps
      : body.subEventId
        ? [body]
        : [];

    for (const entry of rawList) {
      if (entry && typeof entry === 'object') {
        const rawStatus = (entry as Record<string, unknown>).status;
        if (
          typeof rawStatus === 'string' &&
          rawStatus.trim().toLowerCase() !== 'attending' &&
          rawStatus.trim().toLowerCase() !== 'declined'
        ) {
          return errorJson(400, 'Please choose either Attending or Declined.');
        }
      }
    }

    const updatedItems = store.mutate((draft) => {
      let invite = resolveActiveInvitation(draft);
      const nowIso = new Date().toISOString();
      if (!invite) {
        invite = {
          id: generateDemoId('inv'),
          code: 'DEMOGUEST',
          guestName: 'Demo Guest',
          householdName: 'Demo Household',
          email: 'guest@example.org',
          addressLine1: null,
          addressLine2: null,
          city: null,
          state: null,
          zipCode: null,
          country: 'United States',
          dietaryNotes: null,
          plusOneAllocations: 2,
          plusOneFirstName: null,
          plusOneLastName: null,
          partyGroup: 'Friends',
          partyTags: ['VIP'],
          extraFields: null,
          used: true,
          usedAt: nowIso,
          tableId: null,
          seatNumber: null,
          plusOneSeatNumbers: [],
          isSample: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.invitationCode.push(invite);
        draft.householdMember.push(
          ...synthesizeDemoHouseholdMembersFromInvitations([invite], nowIso),
        );
      }

      if (!draft.householdMember.some((m) => m.invitationCodeId === invite!.id)) {
        draft.householdMember.push(
          ...synthesizeDemoHouseholdMembersFromInvitations([invite], nowIso),
        );
      }
      const inviteMembers = draft.householdMember
        .filter((m) => m.invitationCodeId === invite.id)
        .sort((a, b) => a.displayOrder - b.displayOrder);
      const validMemberIds = new Set(inviteMembers.map((m) => m.id));

      const results: Array<Record<string, unknown>> = [];
      for (const entry of rawList) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const subEventId =
          typeof item.subEventId === 'string' ? item.subEventId : '';
        if (!subEventId) continue;

        const rawMemberRsvps = Array.isArray(item.memberRsvps)
          ? item.memberRsvps.filter(
            (mr): mr is Record<string, unknown> =>
              Boolean(mr && typeof mr === 'object') &&
                typeof (mr as Record<string, unknown>).householdMemberId === 'string' &&
                validMemberIds.has(
                  (mr as Record<string, unknown>).householdMemberId as string,
                ),
          )
          : [];

        const hasExplicitMembers = rawMemberRsvps.length > 0;
        const attendingMemberEntries = rawMemberRsvps.filter(
          (mr) => String(mr.status ?? '').toLowerCase() === 'attending',
        );

        const rawStatus =
          typeof item.status === 'string' ? item.status.trim().toLowerCase() : 'attending';
        const status: DemoRsvpStatus = hasExplicitMembers
          ? attendingMemberEntries.length > 0
            ? 'attending'
            : 'declined'
          : rawStatus === 'declined'
            ? 'declined'
            : 'attending';
        const isDeclined = status === 'declined';
        const plusOneCount = hasExplicitMembers
          ? Math.max(0, attendingMemberEntries.length - 1)
          : isDeclined
            ? 0
            : Math.max(0, Number(item.plusOneCount ?? 0) || 0);
        const existingIdx = draft.subEventRsvp.findIndex(
          (r) =>
            r.subEventId === subEventId && r.invitationCodeId === invite!.id,
        );
        const existingRsvp =
          existingIdx >= 0 ? draft.subEventRsvp[existingIdx] : null;
        const rawDietary =
          typeof item.dietaryNotes === 'string'
            ? item.dietaryNotes.trim()
            : undefined;
        const explicitClear = item.clearDietaryNotes === true;
        const hadExistingEventNote = Boolean(existingRsvp?.dietaryNotes?.trim());
        const shouldClearDietary =
          explicitClear || (rawDietary === '' && hadExistingEventNote);
        const dietaryNotes =
          rawDietary && rawDietary.length > 0
            ? rawDietary
            : shouldClearDietary
              ? ''
              : (existingRsvp?.dietaryNotes ?? invite.dietaryNotes ?? '');
        const mealSelections = hasExplicitMembers
          ? attendingMemberEntries
            .map((mr) =>
              typeof mr.mealOptionId === 'string' ? mr.mealOptionId.trim() : '',
            )
            .filter(Boolean)
          : !isDeclined && Array.isArray(item.mealSelections)
            ? item.mealSelections.filter((m): m is string => typeof m === 'string')
            : [];
        const customAnswers =
          !isDeclined &&
          item.customAnswers &&
          typeof item.customAnswers === 'object' &&
          !Array.isArray(item.customAnswers)
            ? (item.customAnswers as Record<string, unknown>)
            : {};
        const plusOneNames = hasExplicitMembers
          ? attendingMemberEntries
            .map((mr) =>
              inviteMembers.find((m) => m.id === mr.householdMemberId),
            )
            .filter((m): m is DemoHouseholdMemberRecord => Boolean(m && m.role !== 'PRIMARY'))
            .map((m) => m.fullName)
          : !isDeclined && Array.isArray(item.plusOneNames)
            ? item.plusOneNames.filter((n): n is string => typeof n === 'string')
            : [];

        const rsvpId =
          existingIdx >= 0
            ? draft.subEventRsvp[existingIdx].id
            : generateDemoId('rsvp');

        const record: DemoSubEventRsvpRecord = {
          id: rsvpId,
          subEventId,
          invitationCodeId: invite.id,
          status,
          plusOneCount,
          dietaryNotes,
          mealSelections,
          customAnswers,
          plusOneNames,
          createdAt:
            existingIdx >= 0 ? draft.subEventRsvp[existingIdx].createdAt : nowIso,
          updatedAt: nowIso,
        };

        if (existingIdx >= 0) {
          draft.subEventRsvp[existingIdx] = record;
        } else {
          draft.subEventRsvp.push(record);
        }

        draft.subEventMemberRsvp = draft.subEventMemberRsvp.filter(
          (mr) => mr.subEventRsvpId !== rsvpId,
        );
        const persistedMemberRsvps: DemoSubEventMemberRsvpRecord[] = hasExplicitMembers
          ? rawMemberRsvps.map((mr) => {
            const memberId = mr.householdMemberId as string;
            const mStatus: DemoRsvpStatus =
              String(mr.status ?? '').toLowerCase() === 'attending'
                ? 'attending'
                : 'declined';
            const mMeal =
              mStatus === 'attending' &&
                typeof mr.mealOptionId === 'string' &&
                mr.mealOptionId.trim()
                ? mr.mealOptionId.trim()
                : null;
            const mDiet =
              typeof mr.dietaryNotes === 'string'
                ? mr.dietaryNotes.trim() || null
                : null;
            const targetMember = inviteMembers.find((m) => m.id === memberId);
            if (targetMember && typeof mr.dietaryNotes === 'string') {
              targetMember.dietaryNotes = mDiet;
              targetMember.updatedAt = nowIso;
            }
            return {
              id: generateDemoId('mrsvp'),
              subEventRsvpId: rsvpId,
              householdMemberId: memberId,
              status: mStatus,
              mealOptionId: mMeal,
              dietaryNotes: mDiet ?? targetMember?.dietaryNotes ?? null,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
          })
          : inviteMembers.map((member, mIdx) => {
            const mStatus: DemoRsvpStatus = isDeclined
              ? 'declined'
              : mIdx <= plusOneCount
                ? 'attending'
                : 'declined';
            return {
              id: generateDemoId('mrsvp'),
              subEventRsvpId: rsvpId,
              householdMemberId: member.id,
              status: mStatus,
              mealOptionId:
                mStatus === 'attending' && mealSelections[mIdx]
                  ? mealSelections[mIdx]
                  : null,
              dietaryNotes:
                mStatus === 'attending'
                  ? member.dietaryNotes || (mIdx === 0 ? dietaryNotes || null : null)
                  : null,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
          });
        draft.subEventMemberRsvp.push(...persistedMemberRsvps);

        invite.used = true;
        invite.usedAt = nowIso;
        if (rawDietary && rawDietary.length > 0) {
          invite.dietaryNotes = rawDietary;
        } else if (shouldClearDietary) {
          invite.dietaryNotes = '';
        }
        invite.extraFields = {
          ...(invite.extraFields && typeof invite.extraFields === 'object'
            ? invite.extraFields
            : {}),
          plusOneCount,
        };
        if (plusOneNames.length > 0) {
          const parts = plusOneNames[0].trim().split(/\s+/);
          invite.plusOneFirstName = parts[0] || null;
          invite.plusOneLastName = parts.slice(1).join(' ') || null;
        }
        invite.updatedAt = nowIso;

        results.push({
          subEventId,
          status,
          plusOneCount,
          dietaryNotes,
          mealSelections,
          customAnswers,
          plusOneNames,
          memberRsvps: persistedMemberRsvps,
        });
      }

      pushAuditVersion(draft, 'InvitationCode', invite.id, invite, invite.guestName);
      return results;
    });

    return wrapMiddlewareJson(updatedItems);
  }

  if (pathname === '/api/photos' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const categoryFilter = searchParams.get('category')?.trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
    );

    const allPhotos = snapshot.contentNode
      .filter((node) => {
        if (node.type.toUpperCase() !== 'PHOTO') return false;
        const st = String(node.data?.status ?? 'APPROVED').toUpperCase();
        if (st === 'PENDING' || st === 'REJECTED') return false;
        if (node.data?.isVisible === false) return false;
        if (categoryFilter && categoryFilter !== 'all') {
          const cat = String(node.data?.category ?? 'curated').toLowerCase();
          return cat === categoryFilter;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((node) => toPhotoDto(snapshot, node));

    const total = allPhotos.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const paged = allPhotos.slice((page - 1) * limit, page * limit);

    return wrapMiddlewareJson({
      success: true,
      data: paged,
      photos: paged,
      total,
      page,
      limit,
      totalPages,
      hasMore: page < totalPages,
    });
  }

  if (
    (pathname === '/api/photos/upload' ||
      pathname === '/api/guest/photos/upload') &&
    method === 'POST'
  ) {
    const contentType = request.headers.get('content-type') || '';
    let uploaderName = store.getSnapshot().guestSession?.guestName || 'Guest';
    let caption = '';
    const files: Array<Blob | { name?: string }> = [];
    const filenames: string[] = [];

    if (contentType.includes('multipart/form-data')) {
      try {
        const formData = await request.formData();
        const rawUploader = formData.get('uploaderName');
        const rawCaption = formData.get('caption');
        if (typeof rawUploader === 'string' && rawUploader.trim()) {
          uploaderName = rawUploader.trim();
        }
        if (typeof rawCaption === 'string' && rawCaption.trim()) {
          caption = rawCaption.trim();
        }
        const multiFiles = [
          ...formData.getAll('files'),
          ...formData.getAll('file'),
        ];
        for (const item of multiFiles) {
          if (item && typeof item === 'object' && 'size' in item) {
            files.push(item as Blob);
            filenames.push(
              'name' in item && typeof item.name === 'string'
                ? item.name
                : 'upload.jpg',
            );
          }
        }
      } catch {
        files.push({ name: 'upload.jpg' });
        filenames.push('upload.jpg');
      }
    } else {
      const body = await readJsonBody(request);
      if (typeof body.uploaderName === 'string' && body.uploaderName.trim()) {
        uploaderName = body.uploaderName.trim();
      }
      if (typeof body.caption === 'string' && body.caption.trim()) {
        caption = body.caption.trim();
      }
      files.push({ name: 'upload.jpg' });
      filenames.push('upload.jpg');
    }

    if (files.length === 0) {
      return errorJson(400, 'Please select at least one photo to upload.');
    }

    const thumbnails: string[] = [];
    for (let i = 0; i < files.length; i += 1) {
      const label = caption || filenames[i] || `Photo ${i + 1}`;
      thumbnails.push(await createCompactUploadThumbnail(files[i], label));
    }

    const createdItems = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const autoApproved = Boolean(getActiveAppConfig(draft).autoApproveGuestPhotos);
      const nextStatus = autoApproved ? 'APPROVED' : 'PENDING';
      return thumbnails.map((url, idx) => {
        const mediaId = generateDemoId('media-guest');
        const nodeId = generateDemoId('photo-guest');
        const publicTitle = caption || `Photo by ${uploaderName}`;
        draft.media.unshift({
          id: mediaId,
          url,
          altText: publicTitle,
          isDecorative: false,
          isSample: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        });
        const newNode: DemoContentNodeRecord = {
          id: nodeId,
          type: 'Photo',
          tags: ['gallery', 'guest-upload'],
          data: {
            mediaId,
            url,
            isVisible: autoApproved,
            status: nextStatus,
            title: publicTitle,
            altText: publicTitle,
            category: 'Guest',
            uploaderName,
            caption,
            originalFilename: filenames[idx] || 'upload.jpg',
            isSample: false,
          },
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.contentNode.unshift(newNode);
        return {
          id: mediaId,
          url,
          altText: publicTitle,
          title: publicTitle,
          uploaderName,
          caption,
          originalFilename: filenames[idx] || 'upload.jpg',
          createdAt: nowIso,
          nodeId,
          status: nextStatus,
          isVisible: autoApproved,
          autoApproved,
          message: autoApproved
            ? 'Photo uploaded and published to the live gallery.'
            : 'Photo submitted successfully. It will be reviewed by the couple before appearing in the gallery.',
        };
      });
    });

    return wrapMiddlewareJson(
      {
        success: true,
        data: createdItems,
      },
      { status: 201 },
    );
  }

  if (pathname === '/api/guest/session' && (method === 'GET' || method === 'DELETE')) {
    if (method === 'DELETE') {
      const nextSession = store.mutate((draft) => {
        if (draft.guestSession?.sessionType === 'invite') {
          draft.guestSession = null;
        }
        return draft.guestSession;
      });
      const hasPasscode = nextSession?.sessionType === 'guest';
      return wrapMiddlewareJson({
        status: hasPasscode ? 'passcode' : 'none',
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        hasPasscodeSession: hasPasscode,
      });
    }

    const snapshot = store.getSnapshot();
    const session = snapshot.guestSession;
    if (!session) {
      return wrapMiddlewareJson({
        status: 'none',
        isVerified: false,
        invitationCode: null,
        code: null,
        guestName: null,
        hasPasscodeSession: false,
      });
    }

    const matchedInvite =
      session.sessionType === 'invite'
        ? snapshot.invitationCode.find(
          (inv) => inv.code.toUpperCase() === session.code.toUpperCase(),
        )
        : null;

    if (session.sessionType === 'invite') {
      if (!matchedInvite || hasUnpromotedAddressCollectionTag(matchedInvite.partyTags)) {
        store.mutate((draft) => {
          if (draft.guestSession?.sessionType === 'invite') {
            draft.guestSession = null;
          }
        });
        return wrapMiddlewareJson({
          status: 'none',
          isVerified: false,
          invitationCode: null,
          code: null,
          guestName: null,
          hasPasscodeSession: false,
        });
      }
      return wrapMiddlewareJson({
        status: 'invitation',
        isVerified: true,
        invitationCode: matchedInvite.code,
        code: matchedInvite.code,
        guestName: matchedInvite.guestName,
        hasPasscodeSession: false,
      });
    }

    return wrapMiddlewareJson({
      status: 'passcode',
      isVerified: false,
      invitationCode: null,
      code: null,
      guestName: null,
      hasPasscodeSession: true,
    });
  }

  if (pathname === '/api/guest/login' && method === 'POST') {
    const body = await readJsonBody(request);
    const passcode =
      typeof body.passcode === 'string' && body.passcode.trim()
        ? body.passcode.trim()
        : typeof body.code === 'string'
          ? body.code.trim()
          : '';
    if (!passcode) {
      return errorJson(400, 'Passcode or invitation code is required.');
    }

    const snapshot = store.getSnapshot();
    const matchedInvite = snapshot.invitationCode.find(
      (inv) => inv.code.toLowerCase() === passcode.toLowerCase(),
    );

    if (matchedInvite) {
      if (hasUnpromotedAddressCollectionTag(matchedInvite.partyTags)) {
        return errorJson(401, 'Invalid passcode or invitation code.');
      }
      store.mutate((draft) => {
        const nowIso = new Date().toISOString();
        draft.guestSession = {
          code: matchedInvite.code,
          guestName: matchedInvite.guestName,
          sessionType: 'invite',
        };
        for (const rec of draft.broadcastRecipient) {
          if (rec.invitationCodeId === matchedInvite.id && rec.status === 'SENT') {
            rec.status = 'VIEWED';
            rec.updatedAt = nowIso;
          }
        }
      });
      return wrapMiddlewareJson({
        success: true,
        sessionType: 'invitation',
        guestName: matchedInvite.guestName,
      });
    }

    if (
      passcode.toLowerCase() === 'wedding2026' ||
      passcode.toLowerCase() === 'demo' ||
      passcode.length >= 4
    ) {
      store.mutate((draft) => {
        draft.guestSession = {
          code: passcode.toUpperCase(),
          guestName: 'Wedding Guest',
          sessionType: 'guest',
        };
      });
      return wrapMiddlewareJson({
        success: true,
        sessionType: 'guest',
      });
    }

    return errorJson(401, 'Invalid passcode or invitation code.');
  }

  if (pathname === '/api/guest/recover' && (method === 'GET' || method === 'POST')) {
    const snapshot = store.getSnapshot();
    const adminConfigView = toAdminConfigDto(getActiveAppConfig(snapshot));
    const emailActive = isEmailProviderActive(adminConfigView);
    const smsActive = isSmsProviderActive(adminConfigView);
    const messagingActive = emailActive || smsActive;

    if (method === 'GET') {
      return wrapMiddlewareJson(
        {
          messagingActive,
          emailActive,
          smsActive,
        },
        {
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    const body = await readJsonBody(request);
    if (hasRecoveryHoneypotTripped(body)) {
      return wrapMiddlewareJson(
        {
          success: true,
          message: RECOVERY_CONFIRMATION_MESSAGE,
        },
        {
          headers: { 'Cache-Control': 'no-store' },
        },
      );
    }

    const parsed = parseRecoveryIdentifier({
      identifier: typeof body.identifier === 'string' ? body.identifier : undefined,
      query: typeof body.query === 'string' ? body.query : undefined,
      email: typeof body.email === 'string' ? body.email : undefined,
      name: typeof body.name === 'string' ? body.name : undefined,
    });
    if (!parsed.ok) {
      return errorJson(400, parsed.error);
    }

    if (!messagingActive) {
      return errorJson(
        503,
        'Outbound email or SMS delivery is not configured on this site. Please contact the hosts directly.',
      );
    }

    const candidates = snapshot.invitationCode.map((inv) => ({
      ...inv,
      members: getOrderedDemoHouseholdMembers(snapshot, inv),
    }));
    const matched = findUnambiguousRecoverableInvitation(candidates, parsed.data);

    if (matched) {
      const { invitation, preferredEmail } = matched;
      const cooldownKey = `staticDemo:${snapshot.activeArchetype}:${invitation.id}`;
      if (!isHouseholdOnRecoveryCooldown(cooldownKey)) {
        const adultMembers = invitation.members.filter((m) => m.role !== 'CHILD');
        const resolvedEmail =
          preferredEmail ||
          (invitation.email && invitation.email.trim() ? invitation.email.trim() : null) ||
          adultMembers.find((m) => m.email && m.email.trim())?.email?.trim() ||
          null;
        const resolvedPhone =
          adultMembers.find((m) => m.phone && m.phone.trim())?.phone?.trim() || null;

        const channel: 'EMAIL' | 'SMS' | null =
          emailActive && resolvedEmail
            ? 'EMAIL'
            : smsActive && resolvedPhone
              ? 'SMS'
              : null;
        const destination = channel === 'EMAIL' ? resolvedEmail : resolvedPhone;

        if (channel && destination) {
          const activeConfig = getActiveAppConfig(snapshot);
          const fallbackOrigin = new URL(request.url).origin;
          const cleanBaseUrl = (activeConfig.baseUrl || fallbackOrigin).replace(/\/+$/, '');
          const rsvpUrl = `${cleanBaseUrl}/guest?code=${encodeURIComponent(invitation.code)}`;
          const coupleLabel =
            activeConfig.heroTitle ||
            [activeConfig.partner1Name, activeConfig.partner2Name].filter(Boolean).join(' & ') ||
            'Our Wedding';

          store.mutate((draft) => {
            const nowIso = new Date().toISOString();
            const broadcastId = generateDemoId('broadcast-recovery');
            draft.broadcastMessage.unshift({
              id: broadcastId,
              channel,
              subject:
                channel === 'EMAIL'
                  ? `Your Guest Portal Sign-In Link — ${coupleLabel}`
                  : null,
              body:
                channel === 'EMAIL'
                  ? `Hello ${invitation.guestName},\n\nHere is your personal one-click sign-in link for ${coupleLabel}:\n\n${rsvpUrl}`
                  : `${coupleLabel}: Open your personal one-click Guest Portal & RSVP sign-in link for ${invitation.guestName}: ${rsvpUrl}`,
              targetFilters: { recovery: true, invitationCodeId: invitation.id },
              status: 'COMPLETED',
              totalRecipients: 1,
              sentCount: 1,
              failedCount: 0,
              scheduledFor: null,
              sentAt: nowIso,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
            draft.broadcastRecipient.unshift({
              id: generateDemoId('brecip-recovery'),
              broadcastId,
              invitationCodeId: invitation.id,
              guestName: invitation.guestName,
              destination,
              status: 'SENT',
              error: null,
              sentAt: nowIso,
              createdAt: nowIso,
              updatedAt: nowIso,
            });
          });
          markHouseholdRecoverySent(cooldownKey);
        }
      }
    }

    return wrapMiddlewareJson(
      {
        success: true,
        message: RECOVERY_CONFIRMATION_MESSAGE,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }

  if (pathname === '/api/guest/lookup' && method === 'POST') {
    const body = await readJsonBody(request);
    const query =
      typeof body.query === 'string'
        ? body.query.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : typeof body.email === 'string'
            ? body.email.trim()
            : '';

    if (!query) {
      return errorJson(400, 'Please enter your name or email.');
    }

    const snapshot = store.getSnapshot();
    const lowered = query.toLowerCase();
    const found = snapshot.invitationCode.find((inv) => {
      if (hasUnpromotedAddressCollectionTag(inv.partyTags)) return false;
      if (
        inv.guestName.toLowerCase().includes(lowered) ||
        (inv.email && inv.email.toLowerCase() === lowered) ||
        inv.code.toLowerCase() === lowered
      ) {
        return true;
      }
      return (snapshot.householdMember ?? []).some(
        (m) =>
          m.invitationCodeId === inv.id &&
          m.role !== 'CHILD' &&
          (m.fullName.toLowerCase().includes(lowered) ||
            (m.email && m.email.toLowerCase() === lowered)),
      );
    });

    if (!found) {
      return errorJson(404, 'No invitation found matching the provided details.');
    }

    store.mutate((draft) => {
      draft.guestSession = {
        code: found.code,
        guestName: found.guestName,
        sessionType: 'invite',
      };
    });

    return wrapMiddlewareJson({
      success: true,
      guestName: found.guestName,
      code: found.code,
      data: {
        guestName: found.guestName,
        code: found.code,
      },
    });
  }

  if (pathname === '/api/guest/address' && (method === 'GET' || method === 'PUT')) {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const invite = resolveActiveInvitation(snapshot);
      if (!invite) {
        return errorJson(401, 'Unauthorized. Please enter your invitation code.');
      }
      return wrapMiddlewareJson({
        guestName: invite.guestName,
        householdName: invite.householdName || '',
        code: invite.code,
        addressLine1: invite.addressLine1 || '',
        addressLine2: invite.addressLine2 || '',
        city: invite.city || '',
        state: invite.state || '',
        zipCode: invite.zipCode || '',
        country: invite.country || '',
        members: getOrderedDemoHouseholdMembers(snapshot, invite),
      });
    }

    const body = await readJsonBody(request);
    const updated = store.mutate((draft) => {
      const invite = resolveActiveInvitation(draft);
      if (!invite) return null;
      const nowIso = new Date().toISOString();
      invite.addressLine1 =
        typeof body.addressLine1 === 'string'
          ? body.addressLine1
          : invite.addressLine1;
      invite.addressLine2 =
        typeof body.addressLine2 === 'string'
          ? body.addressLine2
          : invite.addressLine2;
      invite.city = typeof body.city === 'string' ? body.city : invite.city;
      invite.state = typeof body.state === 'string' ? body.state : invite.state;
      invite.zipCode =
        typeof body.zipCode === 'string' ? body.zipCode : invite.zipCode;
      invite.country =
        typeof body.country === 'string' ? body.country : invite.country;
      if (typeof body.householdName === 'string') {
        invite.householdName = body.householdName.trim() || null;
      }

      if (Array.isArray(body.members) && body.members.length > 0) {
        const existingMembers = getOrderedDemoHouseholdMembers(draft, invite);
        const existingById = new Map(existingMembers.map((m) => [m.id, m]));
        const nextMembers: DemoHouseholdMemberRecord[] = [];
        body.members.forEach((raw, idx) => {
          if (!raw || typeof raw !== 'object') return;
          const rec = raw as Record<string, unknown>;
          const fullName =
            typeof rec.fullName === 'string' ? rec.fullName.trim() : '';
          if (!fullName) return;
          const existing =
            typeof rec.id === 'string' ? existingById.get(rec.id) : undefined;
          const parts = splitMemberFullName(fullName);
          const roleRaw = typeof rec.role === 'string' ? rec.role.toUpperCase() : '';
          const role: DemoHouseholdRole =
            idx === 0
              ? 'PRIMARY'
              : roleRaw === 'PARTNER' || roleRaw === 'CHILD' || roleRaw === 'PLUS_ONE'
                ? roleRaw
                : (existing?.role && existing.role !== 'PRIMARY'
                  ? existing.role
                  : 'PLUS_ONE');
          nextMembers.push({
            id: existing?.id ?? generateDemoId('member'),
            invitationCodeId: invite.id,
            firstName:
              typeof rec.firstName === 'string' && rec.firstName.trim()
                ? rec.firstName.trim()
                : parts.firstName,
            lastName:
              typeof rec.lastName === 'string' && rec.lastName.trim()
                ? rec.lastName.trim()
                : parts.lastName,
            fullName,
            role,
            email:
              rec.email !== undefined
                ? typeof rec.email === 'string' && rec.email.trim()
                  ? rec.email.trim()
                  : null
                : (existing?.email ?? null),
            phone:
              rec.phone !== undefined
                ? typeof rec.phone === 'string' && rec.phone.trim()
                  ? rec.phone.trim()
                  : null
                : (existing?.phone ?? null),
            dietaryNotes:
              rec.dietaryNotes !== undefined
                ? typeof rec.dietaryNotes === 'string' && rec.dietaryNotes.trim()
                  ? rec.dietaryNotes.trim()
                  : null
                : (existing?.dietaryNotes ?? null),
            tags: existing?.tags ?? [],
            displayOrder: idx,
            seatNumber: existing?.seatNumber ?? null,
            createdAt: existing?.createdAt ?? nowIso,
            updatedAt: nowIso,
          });
        });

        if (nextMembers.length > 0) {
          draft.householdMember = draft.householdMember
            .filter((m) => m.invitationCodeId !== invite.id)
            .concat(nextMembers);
          const primary = nextMembers[0];
          invite.guestName = primary.fullName;
          invite.email = primary.email;
          invite.dietaryNotes = primary.dietaryNotes;
          invite.plusOneAllocations = Math.max(
            invite.plusOneAllocations,
            nextMembers.length - 1,
          );
          const firstSecondary = nextMembers[1];
          invite.plusOneFirstName = firstSecondary?.firstName ?? null;
          invite.plusOneLastName = firstSecondary?.lastName ?? null;
        }
      }

      invite.updatedAt = nowIso;
      return {
        guestName: invite.guestName,
        householdName: invite.householdName || '',
        code: invite.code,
        addressLine1: invite.addressLine1 || '',
        addressLine2: invite.addressLine2 || '',
        city: invite.city || '',
        state: invite.state || '',
        zipCode: invite.zipCode || '',
        country: invite.country || '',
        members: getOrderedDemoHouseholdMembers(draft, invite),
      };
    });

    if (!updated) {
      return errorJson(404, 'Invitation code not found.');
    }
    return wrapMiddlewareJson(updated);
  }

  if (pathname === '/api/guest/address/public' && method === 'POST') {
    const body = await readJsonBody(request);
    const honeypotVal =
      body.website || body.honeypot || body.hp_field || body.confirm_email;
    if (typeof honeypotVal === 'string' && honeypotVal.trim().length > 0) {
      return wrapMiddlewareJson({
        success: true,
        message: 'Address submitted successfully.',
      });
    }

    const guestName =
      typeof body.guestName === 'string'
        ? body.guestName.trim()
        : typeof body.name === 'string'
          ? body.name.trim()
          : '';
    const addressLine1 =
      typeof body.addressLine1 === 'string'
        ? body.addressLine1.trim()
        : typeof body.streetAddress === 'string'
          ? body.streetAddress.trim()
          : '';
    const city = typeof body.city === 'string' ? body.city.trim() : '';
    const state = typeof body.state === 'string' ? body.state.trim() : '';
    const zipCode =
      typeof body.zipCode === 'string'
        ? body.zipCode.trim()
        : typeof body.postalCode === 'string'
          ? body.postalCode.trim()
          : '';

    if (!guestName) {
      return errorJson(400, 'Please enter your full name.');
    }
    if (!addressLine1) {
      return errorJson(400, 'Street address is required.', {
        details: {
          _errors: [],
          addressLine1: { _errors: ['Street address is required.'] },
        },
      });
    }
    if (!city) {
      return errorJson(400, 'City is required.', {
        details: {
          _errors: [],
          city: { _errors: ['City is required.'] },
        },
      });
    }
    if (!state) {
      return errorJson(400, 'State / Province is required.', {
        details: {
          _errors: [],
          state: { _errors: ['State / Province is required.'] },
        },
      });
    }
    if (!zipCode) {
      return errorJson(400, 'ZIP / Postal code is required.', {
        details: {
          _errors: [],
          zipCode: { _errors: ['ZIP / Postal code is required.'] },
        },
      });
    }
    const rawEmail = typeof body.email === 'string' ? body.email.trim() : '';
    if (rawEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
      return errorJson(400, 'Invalid email address.', {
        details: {
          _errors: [],
          email: { _errors: ['Invalid email address.'] },
        },
      });
    }

    const rawPhone =
      typeof body.phone === 'string' && body.phone.trim()
        ? body.phone.trim()
        : typeof body.mobile === 'string' && body.mobile.trim()
          ? body.mobile.trim()
          : typeof body.phoneNumber === 'string' && body.phoneNumber.trim()
            ? body.phoneNumber.trim()
            : '';
    const rawNotes =
      typeof body.notes === 'string' && body.notes.trim()
        ? body.notes.trim()
        : typeof body.householdNotes === 'string' && body.householdNotes.trim()
          ? body.householdNotes.trim()
          : '';

    const rawDietaryNotes =
      typeof body.dietaryNotes === 'string' && body.dietaryNotes.trim()
        ? body.dietaryNotes.trim()
        : '';
    const rawPartner =
      body.partner && typeof body.partner === 'object' && !Array.isArray(body.partner)
        ? (body.partner as Record<string, unknown>)
        : null;
    const partnerFullName =
      rawPartner && typeof rawPartner.fullName === 'string'
        ? rawPartner.fullName.trim()
        : '';
    const partnerEmail =
      rawPartner && typeof rawPartner.email === 'string'
        ? rawPartner.email.trim()
        : '';
    if (partnerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
      return errorJson(400, 'Invalid partner email address.');
    }
    const partnerPhone =
      rawPartner && typeof rawPartner.phone === 'string'
        ? rawPartner.phone.trim()
        : '';
    const partnerDietary =
      rawPartner && typeof rawPartner.dietaryNotes === 'string'
        ? rawPartner.dietaryNotes.trim()
        : '';
    const parsedChildren = Array.isArray(body.children)
      ? body.children
        .filter((c): c is Record<string, unknown> => Boolean(c && typeof c === 'object'))
        .map((c) => ({
          fullName: typeof c.fullName === 'string' ? c.fullName.trim() : '',
          dietaryNotes:
            typeof c.dietaryNotes === 'string' ? c.dietaryNotes.trim() : '',
        }))
        .filter((c) => c.fullName.length > 0)
      : [];

    const outcome = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const appendSubmittedMembers = (targetInvite: DemoInvitationCodeRecord) => {
        if (!draft.householdMember.some((m) => m.invitationCodeId === targetInvite.id)) {
          draft.householdMember.push(
            ...synthesizeDemoHouseholdMembersFromInvitations([targetInvite], nowIso),
          );
        }
        const existingForInvite = draft.householdMember
          .filter((m) => m.invitationCodeId === targetInvite.id)
          .sort((a, b) => a.displayOrder - b.displayOrder);
        const primaryMember = existingForInvite[0];
        if (primaryMember) {
          if (!primaryMember.email && rawEmail) primaryMember.email = rawEmail;
          if (!primaryMember.phone && rawPhone) primaryMember.phone = rawPhone;
          if (!primaryMember.dietaryNotes && rawDietaryNotes) {
            primaryMember.dietaryNotes = rawDietaryNotes;
          }
          primaryMember.updatedAt = nowIso;
        }
        let nextOrder = existingForInvite.length;
        const hasName = (candidate: string) =>
          draft.householdMember.some(
            (m) =>
              m.invitationCodeId === targetInvite.id &&
              m.fullName.trim().toLowerCase() === candidate.toLowerCase(),
          );
        if (partnerFullName && !hasName(partnerFullName)) {
          const pParts = splitMemberFullName(partnerFullName);
          draft.householdMember.push({
            id: generateDemoId('member'),
            invitationCodeId: targetInvite.id,
            firstName: pParts.firstName,
            lastName: pParts.lastName,
            fullName: partnerFullName,
            role: 'PARTNER',
            email: partnerEmail || null,
            phone: partnerPhone || null,
            dietaryNotes: partnerDietary || null,
            tags: [],
            displayOrder: nextOrder++,
            seatNumber: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
          if (!targetInvite.plusOneFirstName && !targetInvite.plusOneLastName) {
            targetInvite.plusOneFirstName = pParts.firstName;
            targetInvite.plusOneLastName = pParts.lastName;
          }
        }
        for (const child of parsedChildren) {
          if (hasName(child.fullName)) continue;
          const cParts = splitMemberFullName(child.fullName);
          draft.householdMember.push({
            id: generateDemoId('member'),
            invitationCodeId: targetInvite.id,
            firstName: cParts.firstName,
            lastName: cParts.lastName,
            fullName: child.fullName,
            role: 'CHILD',
            email: null,
            phone: null,
            dietaryNotes: child.dietaryNotes || null,
            tags: ['kid'],
            displayOrder: nextOrder++,
            seatNumber: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          });
        }
        const totalMembers = draft.householdMember.filter(
          (m) => m.invitationCodeId === targetInvite.id,
        ).length;
        targetInvite.plusOneAllocations = Math.max(
          targetInvite.plusOneAllocations,
          totalMembers - 1,
        );
      };

      const matchedRecord = draft.invitationCode.find((inv) => {
        if (inv.isSample) return false;
        if (rawEmail && inv.email && inv.email.toLowerCase() === rawEmail.toLowerCase()) {
          return true;
        }
        return inv.guestName.trim().toLowerCase() === guestName.toLowerCase();
      });

      const existingAddressLine1 = matchedRecord?.addressLine1?.trim() ?? '';
      const hasAddressConflict = Boolean(
        matchedRecord &&
          existingAddressLine1 &&
          addressLine1 &&
          existingAddressLine1.toLowerCase() !== addressLine1.toLowerCase(),
      );

      if (matchedRecord && !hasAddressConflict) {
        if (!matchedRecord.email?.trim() && rawEmail) {
          matchedRecord.email = rawEmail;
        }
        if (
          !matchedRecord.householdName?.trim() &&
          typeof body.householdName === 'string' &&
          body.householdName.trim()
        ) {
          matchedRecord.householdName = body.householdName.trim();
        }
        if (!existingAddressLine1 && addressLine1) {
          matchedRecord.addressLine1 = addressLine1;
        }
        if (
          !matchedRecord.addressLine2?.trim() &&
          typeof body.addressLine2 === 'string' &&
          body.addressLine2.trim()
        ) {
          matchedRecord.addressLine2 = body.addressLine2.trim();
        }
        if (!matchedRecord.city?.trim() && city) {
          matchedRecord.city = city;
        }
        if (!matchedRecord.state?.trim() && state) {
          matchedRecord.state = state;
        }
        if (!matchedRecord.zipCode?.trim() && zipCode) {
          matchedRecord.zipCode = zipCode;
        }
        if (
          !matchedRecord.country?.trim() &&
          typeof body.country === 'string' &&
          body.country.trim()
        ) {
          matchedRecord.country = body.country.trim();
        }
        if (rawPhone || rawNotes) {
          const nextExtra: Record<string, unknown> =
            matchedRecord.extraFields && typeof matchedRecord.extraFields === 'object'
              ? { ...matchedRecord.extraFields }
              : {};
          if (rawPhone) {
            if (!nextExtra.phone) nextExtra.phone = rawPhone;
            if (!nextExtra.mobile) nextExtra.mobile = rawPhone;
          }
          if (rawNotes) {
            nextExtra.householdNotes = nextExtra.householdNotes
              ? `${String(nextExtra.householdNotes)}; ${rawNotes}`
              : rawNotes;
          }
          matchedRecord.extraFields = nextExtra;
        }
        if (!matchedRecord.dietaryNotes?.trim() && rawDietaryNotes) {
          matchedRecord.dietaryNotes = rawDietaryNotes;
        }
        appendSubmittedMembers(matchedRecord);
        matchedRecord.updatedAt = nowIso;
        pushAuditVersion(draft, 'InvitationCode', matchedRecord.id, matchedRecord, guestName);
        return { record: matchedRecord, status: 200 as const };
      }

      const existingCodes = new Set(
        draft.invitationCode.map((i) => i.code.toUpperCase()),
      );
      const code = generateRandomInviteCode(existingCodes);
      const extraFields: Record<string, unknown> = {};
      if (rawPhone) {
        extraFields.phone = rawPhone;
        extraFields.mobile = rawPhone;
      }
      if (rawNotes) {
        extraFields.householdNotes = rawNotes;
      }

      const newInvite: DemoInvitationCodeRecord = {
        id: generateDemoId('inv'),
        code,
        guestName,
        householdName:
          typeof body.householdName === 'string' && body.householdName.trim()
            ? body.householdName.trim()
            : guestName,
        email: rawEmail || null,
        addressLine1,
        addressLine2:
          typeof body.addressLine2 === 'string' ? body.addressLine2.trim() : null,
        city,
        state: state || null,
        zipCode: zipCode || null,
        country:
          typeof body.country === 'string' && body.country.trim()
            ? body.country.trim()
            : 'United States',
        dietaryNotes: rawDietaryNotes || null,
        plusOneAllocations: (partnerFullName ? 1 : 0) + parsedChildren.length,
        plusOneFirstName: partnerFullName ? splitMemberFullName(partnerFullName).firstName : null,
        plusOneLastName: partnerFullName ? splitMemberFullName(partnerFullName).lastName : null,
        partyGroup: 'Address Book',
        partyTags: ['Submitted Address', 'address-collection'],
        extraFields: Object.keys(extraFields).length > 0 ? extraFields : null,
        used: false,
        usedAt: null,
        tableId: null,
        seatNumber: null,
        plusOneSeatNumbers: [],
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.invitationCode.unshift(newInvite);
      const primaryParts = splitMemberFullName(guestName);
      draft.householdMember.push({
        id: generateDemoId('member'),
        invitationCodeId: newInvite.id,
        firstName: primaryParts.firstName,
        lastName: primaryParts.lastName,
        fullName: guestName,
        role: 'PRIMARY',
        email: rawEmail || null,
        phone: rawPhone || null,
        dietaryNotes: rawDietaryNotes || null,
        tags: [...newInvite.partyTags],
        displayOrder: 0,
        seatNumber: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      });
      appendSubmittedMembers(newInvite);
      pushAuditVersion(draft, 'InvitationCode', newInvite.id, newInvite, guestName);
      return { record: newInvite, status: 201 as const };
    });

    return wrapMiddlewareJson(
      {
        success: true,
        message: 'Address submitted successfully.',
        code: outcome.record.code,
        data: {
          id: outcome.record.id,
          code: outcome.record.code,
          guestName: outcome.record.guestName,
        },
      },
      { status: outcome.status },
    );
  }

  return null;
}
