import type {
  DemoContentNodeRecord,
  DemoInvitationCodeRecord,
  DemoRsvpStatus,
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
  pushAuditVersion,
  toPhotoDto,
} from '../dtoMappers';
import { buildSubEventIcs } from '../exporters';
import { createCompactUploadThumbnail, createDemoSvgDataUrl } from '../svgAssets';
import type { CustomRsvpQuestionDTO, MealOptionDTO } from '@/utils/rsvpPrompts';

function resolveActiveInvitation(
  snapshot: StaticDemoSnapshot,
): DemoInvitationCodeRecord | null {
  if (snapshot.guestSession?.code) {
    const exact = snapshot.invitationCode.find(
      (inv) => inv.code.toUpperCase() === snapshot.guestSession?.code.toUpperCase(),
    );
    if (exact) return exact;
  }
  return (
    snapshot.invitationCode.find((inv) => !inv.isSample) ??
    snapshot.invitationCode[0] ??
    null
  );
}

function buildClimateForecast(latitude: number, weddingDateIso: string) {
  const dayStr = weddingDateIso.slice(0, 10) || '2026-09-19';
  const weddingMs =
    Date.parse(`${dayStr}T00:00:00Z`) || Date.parse('2026-09-19T00:00:00Z');
  const availStr = new Date(weddingMs - 16 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
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
      buildClimateForecast(config.latitude, config.weddingDate),
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
          }
          : {
            status: 'pending',
            plusOneCount: 0,
            dietaryNotes: activeInvite?.dietaryNotes ?? '',
            mealSelections: [],
            customAnswers: {},
            plusOneNames: [],
          },
      };
    });

    const savedPlusOneNames =
      activeInvite?.plusOneFirstName || activeInvite?.plusOneLastName
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
      }

      const results: Array<Record<string, unknown>> = [];
      for (const entry of rawList) {
        if (!entry || typeof entry !== 'object') continue;
        const item = entry as Record<string, unknown>;
        const subEventId =
          typeof item.subEventId === 'string' ? item.subEventId : '';
        if (!subEventId) continue;

        const rawStatus =
          typeof item.status === 'string' ? item.status.trim().toLowerCase() : 'attending';
        const status: DemoRsvpStatus =
          rawStatus === 'declined' ? 'declined' : 'attending';
        const isDeclined = status === 'declined';
        const plusOneCount = isDeclined
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
        const mealSelections =
          !isDeclined && Array.isArray(item.mealSelections)
            ? item.mealSelections.filter((m): m is string => typeof m === 'string')
            : [];
        const customAnswers =
          !isDeclined &&
          item.customAnswers &&
          typeof item.customAnswers === 'object' &&
          !Array.isArray(item.customAnswers)
            ? (item.customAnswers as Record<string, unknown>)
            : {};
        const plusOneNames =
          !isDeclined && Array.isArray(item.plusOneNames)
            ? item.plusOneNames.filter((n): n is string => typeof n === 'string')
            : [];

        const record: DemoSubEventRsvpRecord = {
          id:
            existingIdx >= 0
              ? draft.subEventRsvp[existingIdx].id
              : generateDemoId('rsvp'),
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
            isVisible: false,
            status: 'PENDING',
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
          status: 'PENDING',
          isVisible: false,
          message:
            'Photo submitted successfully. It will be reviewed by the couple before appearing in the gallery.',
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
      const resolvedCode = matchedInvite?.code ?? session.code;
      const resolvedName = matchedInvite?.guestName ?? session.guestName;
      return wrapMiddlewareJson({
        status: 'invitation',
        isVerified: true,
        invitationCode: resolvedCode,
        code: resolvedCode,
        guestName: resolvedName,
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
    const found = snapshot.invitationCode.find(
      (inv) =>
        inv.guestName.toLowerCase().includes(lowered) ||
        (inv.email && inv.email.toLowerCase() === lowered) ||
        inv.code.toLowerCase() === lowered,
    );

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
        code: invite.code,
        addressLine1: invite.addressLine1 || '',
        addressLine2: invite.addressLine2 || '',
        city: invite.city || '',
        state: invite.state || '',
        zipCode: invite.zipCode || '',
        country: invite.country || '',
      });
    }

    const body = await readJsonBody(request);
    const updated = store.mutate((draft) => {
      const invite = resolveActiveInvitation(draft);
      if (!invite) return null;
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
      invite.updatedAt = new Date().toISOString();
      return {
        guestName: invite.guestName,
        code: invite.code,
        addressLine1: invite.addressLine1 || '',
        addressLine2: invite.addressLine2 || '',
        city: invite.city || '',
        state: invite.state || '',
        zipCode: invite.zipCode || '',
        country: invite.country || '',
      };
    });

    if (!updated) {
      return errorJson(404, 'Invitation code not found.');
    }
    return wrapMiddlewareJson(updated);
  }

  if (pathname === '/api/guest/address/public' && method === 'POST') {
    const body = await readJsonBody(request);
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

    const outcome = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
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
        extraFields.notes = rawNotes;
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
        dietaryNotes: null,
        plusOneAllocations: 0,
        plusOneFirstName: null,
        plusOneLastName: null,
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
