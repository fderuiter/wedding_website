import { isValidArchetypeId, buildArchetypeSeedSnapshot } from '../seeds';
import type {
  DemoBroadcastMessageRecord,
  DemoBroadcastRecipientRecord,
  DemoContributorRecord,
  DemoInvitationCodeRecord,
  DemoRsvpStatus,
  DemoSubEventRsvpRecord,
  NormalizedDemoRequest,
  StaticDemoSnapshot,
  StaticDemoStore,
} from '../types';
import {
  STATIC_DEMO_BACKUP_SCHEMA_VERSION,
  STATIC_DEMO_STORE_VERSION,
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
  recalculateRegistryItemTotals,
  toAdminConfigDto,
  toContributorDto,
  toInvitationCodeDto,
  toInvitationSubEventRsvps,
  toPhotoDto,
  toPublicConfigDto,
  toRegistryItemDto,
} from '../dtoMappers';
import {
  buildBackupExportPayload,
  buildInvitationCodesCsv,
  buildSeatingCsv,
  buildSeatingMealCountsCsv,
  buildSimplePdfBytes,
  buildStoredZipBytes,
  buildThankYouNotesCsv,
  isDemoLandmarkShape,
} from '../exporters';
import { createCompactUploadThumbnail } from '../svgAssets';

function maskEmail(email: string): string {
  if (!email.includes('@')) return '[REDACTED]';
  const [local, domain] = email.split('@');
  if (!local) return '[REDACTED]';
  if (local.length <= 2) return `${local[0] || ''}***@${domain}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}

function sanitizeVersionData(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(sanitizeVersionData);
  const record = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    const lk = k.toLowerCase();
    if (lk.includes('email') && typeof v === 'string' && v.length > 0) {
      out[k] = maskEmail(v);
    } else if (
      (lk === 'phone' || lk === 'phonenumber' || lk === 'shippingphone') &&
      typeof v === 'string' &&
      v.length > 0
    ) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = sanitizeVersionData(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function computeSampleDataCounts(snapshot: StaticDemoSnapshot) {
  const faqs = snapshot.contentNode.filter(
    (n) => n.type.toUpperCase() === 'FAQ' && Boolean(n.data?.isSample),
  ).length;
  const counts = {
    registry: snapshot.registryItem.filter((r) => r.isSample).length,
    guests: snapshot.invitationCode.filter((i) => i.isSample).length,
    seating: snapshot.seatingTable.filter((t) => t.isSample).length,
    weddingParty: snapshot.weddingPartyMember.filter((m) => m.isSample).length,
    attractions: snapshot.attraction.filter((a) => a.isSample).length,
    faqs,
  };
  const hasSampleData = Object.values(counts).some((c) => c > 0);
  return { hasSampleData, counts };
}

function interpolateBroadcastTemplate(
  template: string,
  guest: { guestName: string; code: string; householdName: string | null },
  partner1Name: string,
  partner2Name: string,
  baseUrl: string,
): string {
  return template
    .replace(/\{\{\s*guestName\s*\}\}/g, guest.guestName)
    .replace(/\{\{\s*code\s*\}\}/g, guest.code)
    .replace(/\{\{\s*householdName\s*\}\}/g, guest.householdName || guest.guestName)
    .replace(/\{\{\s*partner1Name\s*\}\}/g, partner1Name)
    .replace(/\{\{\s*partner2Name\s*\}\}/g, partner2Name)
    .replace(/\{\{\s*baseUrl\s*\}\}/g, baseUrl);
}

export async function handleAdminWorkflowRoutes(
  req: NormalizedDemoRequest,
  store: StaticDemoStore,
): Promise<Response | null> {
  const { method, pathname, searchParams, request } = req;

  // --- Admin Session & Auth ---
  if (pathname === '/api/admin/login' && method === 'POST') {
    store.mutate((draft) => {
      draft.isAdminAuthenticated = true;
    });
    return wrapMiddlewareJson({ success: true });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    store.mutate((draft) => {
      draft.isAdminAuthenticated = false;
    });
    return wrapMiddlewareJson({ success: true });
  }

  if (pathname === '/api/admin/me' && method === 'GET') {
    const snapshot = store.getSnapshot();
    return wrapMiddlewareJson({
      authenticated: snapshot.isAdminAuthenticated,
      isAdmin: snapshot.isAdminAuthenticated,
    });
  }

  // --- First-Run Setup Wizard ---
  if (pathname === '/api/admin/setup') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const config = getActiveAppConfig(snapshot);
      const initialized = !snapshot.isSetupMode;
      const setupCompleted = initialized && config.setupCompleted !== false;
      return wrapMiddlewareJson({
        success: true,
        initialized,
        setupCompleted,
        requiresSetup: !initialized || !setupCompleted,
      });
    }

    if (method === 'POST') {
      const body = await readJsonBody(request);
      const hasConfigPayload =
        body.partner1Name !== undefined ||
        body.partner2Name !== undefined ||
        body.brideName !== undefined ||
        body.groomName !== undefined ||
        body.baseUrl !== undefined ||
        body.contactEmail !== undefined;

      if (!hasConfigPayload) {
        const outcome = store.mutate((draft) => {
          draft.isAdminAuthenticated = true;
          const config = getActiveAppConfig(draft);
          if (typeof body.setupCompleted === 'boolean') {
            config.setupCompleted = body.setupCompleted;
            if (body.setupCompleted) {
              draft.isSetupMode = false;
            }
            config.updatedAt = new Date().toISOString();
          }
          const initialized = !draft.isSetupMode;
          const setupCompleted = initialized && config.setupCompleted !== false;
          return { initialized, setupCompleted };
        });
        return wrapMiddlewareJson({
          success: true,
          initialized: outcome.initialized,
          setupCompleted: outcome.setupCompleted,
          requiresSetup: !outcome.initialized || !outcome.setupCompleted,
        });
      }

      const partner1Name =
        typeof body.partner1Name === 'string' && body.partner1Name.trim()
          ? body.partner1Name.trim()
          : typeof body.brideName === 'string' && body.brideName.trim()
            ? body.brideName.trim()
            : '';
      const partner2Name =
        typeof body.partner2Name === 'string' && body.partner2Name.trim()
          ? body.partner2Name.trim()
          : typeof body.groomName === 'string' && body.groomName.trim()
            ? body.groomName.trim()
            : '';

      if (!partner1Name || !partner2Name) {
        return errorJson(400, 'Both partner names are required.');
      }

      const requestedSetupCompleted =
        typeof body.setupCompleted === 'boolean' ? body.setupCompleted : true;

      const updatedConfig = store.mutate((draft) => {
        const config = getActiveAppConfig(draft);
        const nowIso = new Date().toISOString();
        config.partner1Name = partner1Name;
        config.partner2Name = partner2Name;
        config.brideName = partner1Name;
        config.groomName = partner2Name;
        if (typeof body.weddingDate === 'string' && body.weddingDate.trim()) {
          config.weddingDate = body.weddingDate.trim();
        }
        if (typeof body.baseUrl === 'string' && body.baseUrl.trim()) {
          config.baseUrl = body.baseUrl.trim();
        }
        if (typeof body.contactEmail === 'string') {
          config.contactEmail = body.contactEmail.trim();
        }
        if (typeof body.venueName === 'string') {
          config.venueName = body.venueName.trim();
        }
        if (typeof body.venueAddress === 'string') {
          config.venueAddress = body.venueAddress.trim();
        }
        if (typeof body.venueCity === 'string') {
          config.venueCity = body.venueCity.trim();
        }
        if (typeof body.venueState === 'string') {
          config.venueState = body.venueState.trim();
        }
        if (typeof body.venueZip === 'string') {
          config.venueZip = body.venueZip.trim();
        }
        if (typeof body.timezone === 'string' && body.timezone.trim()) {
          config.timezone = body.timezone.trim();
        }
        if (typeof body.themePreset === 'string' && body.themePreset.trim()) {
          config.themePreset = body.themePreset.trim();
        }
        if (typeof body.colorPrimary === 'string' && body.colorPrimary.trim()) {
          config.colorPrimary = body.colorPrimary.trim();
        }
        if (typeof body.colorSecondary === 'string' && body.colorSecondary.trim()) {
          config.colorSecondary = body.colorSecondary.trim();
        }
        config.heroTitle =
          typeof body.heroTitle === 'string' && body.heroTitle.trim()
            ? body.heroTitle.trim()
            : `${partner1Name} & ${partner2Name}`;
        config.seoTitle = `${partner1Name} & ${partner2Name} Wedding`;
        config.setupCompleted = requestedSetupCompleted;
        if (requestedSetupCompleted) {
          draft.isSetupMode = false;
        }
        config.updatedAt = nowIso;
        draft.isAdminAuthenticated = true;
        pushAuditVersion(draft, 'AppConfig', config.id, config, 'Setup Wizard');
        return toPublicConfigDto(config);
      });

      return wrapMiddlewareJson({
        success: true,
        initialized: true,
        ...updatedConfig,
        config: updatedConfig,
        setupCompleted: requestedSetupCompleted,
      });
    }
  }

  // --- Onboarding Milestones ---
  if (pathname === '/api/admin/onboarding-milestones' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    const rawVenueName = (config.venueName || '').trim();
    const normalizedVenueName = rawVenueName.toUpperCase();
    const hasVenueName =
      Boolean(rawVenueName) &&
      normalizedVenueName !== 'TBD' &&
      normalizedVenueName !== 'TBD VENUE';
    const hasWeddingDate =
      Boolean(config.weddingDate?.trim()) &&
      !Number.isNaN(new Date(config.weddingDate).getTime());
    const weddingDetailsCompleted =
      !snapshot.isSetupMode &&
      Boolean(
        config.partner1Name.trim() &&
          config.partner2Name.trim() &&
          config.baseUrl.trim(),
      ) &&
      hasWeddingDate &&
      hasVenueName;
    const guestListCompleted = snapshot.invitationCode.some((i) => !i.isSample);
    const registryCompleted = snapshot.registryItem.some((r) => !r.isSample);
    const seatingCompleted = snapshot.seatingTable.some((t) => !t.isSample);
    const faqCompleted = snapshot.contentNode.some(
      (n) =>
        n.type.toUpperCase() === 'FAQ' &&
        !n.data?.isSample &&
        n.data?.isVisible !== false &&
        Boolean(n.data?.question && n.data?.answer),
    );

    const milestones = [
      {
        id: 'wedding-details',
        title: 'Wedding Details',
        description:
          'Verify partner names, wedding date, venue details, and your public website URL.',
        completed: weddingDetailsCompleted,
        href: '/admin/dashboard/settings',
        actionLabel: weddingDetailsCompleted
          ? 'Edit Wedding Details'
          : 'Configure Wedding Details',
      },
      {
        id: 'guest-list',
        title: 'Guest List',
        description: 'Import or add guest invitations so guests can RSVP.',
        completed: guestListCompleted,
        href: '/admin/dashboard/invitation-codes',
        actionLabel: guestListCompleted ? 'Manage Guest List' : 'Add Guest List',
      },
      {
        id: 'registry',
        title: 'Gift Registry',
        description: 'Add gifts or cash funds to your wedding registry.',
        completed: registryCompleted,
        href: '/registry/add-item',
        actionLabel: registryCompleted ? 'Add More Gifts' : 'Add Registry Gifts',
      },
      {
        id: 'seating-layout',
        title: 'Seating Layout',
        description: 'Create reception tables and organize your seating chart.',
        completed: seatingCompleted,
        href: '/admin/dashboard/seating-chart',
        actionLabel: seatingCompleted
          ? 'Edit Seating Layout'
          : 'Create Seating Layout',
      },
      {
        id: 'faq-setup',
        title: 'Wedding Q&A (FAQs)',
        description:
          'Publish guest Q&A answers for attire, RSVP deadlines, travel, and accommodations.',
        completed: faqCompleted,
        href: '/admin/dashboard/content',
        actionLabel: faqCompleted ? 'Manage Wedding Q&A' : 'Add Starter FAQs',
      },
    ];

    const totalCount = milestones.length;
    const completedCount = milestones.filter((m) => m.completed).length;
    const pendingCount = totalCount - completedCount;

    return wrapMiddlewareJson({
      success: true,
      completedCount,
      pendingCount,
      totalCount,
      allComplete: completedCount === totalCount,
      milestones,
    });
  }

  // --- Sample Data Lifecycle ---
  if (pathname === '/api/admin/sample-data') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const status = computeSampleDataCounts(snapshot);
      return wrapMiddlewareJson({
        success: true,
        ...status,
      });
    }

    if (method === 'POST') {
      const body = await readJsonBody(request);
      const archetype = isValidArchetypeId(body.archetype)
        ? body.archetype
        : store.getSnapshot().activeArchetype;
      const modulesFilter = Array.isArray(body.modules)
        ? new Set(body.modules.filter((m): m is string => typeof m === 'string'))
        : null;

      const createdCounts = store.mutate((draft) => {
        const seed = buildArchetypeSeedSnapshot(archetype);
        const suffix = Date.now().toString(36).slice(-4);
        const counts = {
          registry: 0,
          guests: 0,
          seating: 0,
          weddingParty: 0,
          attractions: 0,
          faqs: 0,
        };

        for (const m of seed.media) {
          if (!draft.media.some((existing) => existing.id === m.id)) {
            draft.media.push({ ...m, isSample: true });
          }
        }

        if (!modulesFilter || modulesFilter.has('registry')) {
          for (const item of seed.registryItem.slice(0, 3)) {
            draft.registryItem.push({
              ...item,
              id: `sample-reg-${suffix}-${counts.registry + 1}`,
              isSample: true,
              amountContributed: 0,
              purchased: false,
            });
            counts.registry += 1;
          }
        }

        if (!modulesFilter || modulesFilter.has('seating')) {
          for (const tbl of seed.seatingTable.slice(0, 2)) {
            draft.seatingTable.push({
              ...tbl,
              id: `sample-tbl-${suffix}-${counts.seating + 1}`,
              name: `${tbl.name} (Sample)`,
              isSample: true,
            });
            counts.seating += 1;
          }
        }

        if (!modulesFilter || modulesFilter.has('guests')) {
          for (const inv of seed.invitationCode.slice(0, 3)) {
            draft.invitationCode.push({
              ...inv,
              id: `sample-inv-${suffix}-${counts.guests + 1}`,
              code: `SMP${suffix.toUpperCase()}${counts.guests + 1}`,
              isSample: true,
              tableId: null,
              seatNumber: null,
              plusOneSeatNumbers: [],
            });
            counts.guests += 1;
          }
        }

        if (!modulesFilter || modulesFilter.has('weddingParty')) {
          for (const member of seed.weddingPartyMember.slice(0, 2)) {
            draft.weddingPartyMember.push({
              ...member,
              id: `sample-party-${suffix}-${counts.weddingParty + 1}`,
              isSample: true,
            });
            counts.weddingParty += 1;
          }
        }

        if (!modulesFilter || modulesFilter.has('attractions')) {
          for (const attr of seed.attraction.slice(0, 2)) {
            draft.attraction.push({
              ...attr,
              id: `sample-attr-${suffix}-${counts.attractions + 1}`,
              isSample: true,
            });
            counts.attractions += 1;
          }
        }

        if (!modulesFilter || modulesFilter.has('faqs')) {
          const seedFaqs = seed.contentNode.filter(
            (n) => n.type.toUpperCase() === 'FAQ',
          );
          for (const faq of seedFaqs.slice(0, 2)) {
            draft.contentNode.push({
              ...faq,
              id: `sample-faq-${suffix}-${counts.faqs + 1}`,
              data: { ...faq.data, isSample: true },
            });
            counts.faqs += 1;
          }
        }

        return counts;
      });

      return wrapMiddlewareJson({
        success: true,
        archetype,
        createdCounts,
      });
    }

    if (method === 'DELETE') {
      const purgedCounts = store.mutate((draft) => {
        const previous = computeSampleDataCounts(draft).counts;
        const sampleItemIds = new Set(
          draft.registryItem.filter((r) => r.isSample).map((r) => r.id),
        );
        const sampleInviteIds = new Set(
          draft.invitationCode.filter((i) => i.isSample).map((i) => i.id),
        );

        draft.contributor = draft.contributor.filter(
          (c) =>
            !(c.registryItemId && sampleItemIds.has(c.registryItemId)) &&
            !(c.invitationCodeId && sampleInviteIds.has(c.invitationCodeId)),
        );
        draft.subEventAccess = draft.subEventAccess.filter(
          (a) => !sampleInviteIds.has(a.invitationCodeId),
        );
        draft.subEventRsvp = draft.subEventRsvp.filter(
          (r) => !sampleInviteIds.has(r.invitationCodeId),
        );
        draft.registryItem = draft.registryItem.filter((r) => !r.isSample);
        draft.invitationCode = draft.invitationCode.filter((i) => !i.isSample);
        draft.seatingTable = draft.seatingTable.filter((t) => !t.isSample);
        draft.weddingPartyMember = draft.weddingPartyMember.filter(
          (m) => !m.isSample,
        );
        draft.attraction = draft.attraction.filter((a) => !a.isSample);
        draft.contentNode = draft.contentNode.filter(
          (n) => !(n.type.toUpperCase() === 'FAQ' && Boolean(n.data?.isSample)),
        );
        draft.media = draft.media.filter((m) => !m.isSample);
        return previous;
      });

      return wrapMiddlewareJson({
        success: true,
        purgedCounts,
      });
    }
  }

  // --- Settings & Feature Toggles ---
  if (pathname === '/api/admin/settings') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const config = getActiveAppConfig(snapshot);
      if (searchParams.get('list') === 'true') {
        return wrapMiddlewareJson([toAdminConfigDto(config)]);
      }
      return wrapMiddlewareJson(toAdminConfigDto(config));
    }

    if (method === 'PUT' || method === 'POST') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) => {
        const config = getActiveAppConfig(draft);
        const editableStringFields = [
          'partner1Name',
          'partner2Name',
          'brideName',
          'groomName',
          'weddingDate',
          'baseUrl',
          'venueName',
          'venueAddress',
          'venueCity',
          'venueState',
          'venueZip',
          'storyText',
          'venueDescription',
          'travelAdvice',
          'heroTitle',
          'heroSubtitle',
          'seoTitle',
          'seoDescription',
          'seoKeywords',
          'contactEmail',
          'photoAlbumUrl',
          'faviconUrl',
          'ogImageUrl',
          'brandMonogram',
          'brandLogoUrl',
          'brandLogoAlt',
          'heroImageUrl',
          'heroImageAlt',
          'colorPrimary',
          'colorSecondary',
          'themePreset',
          'layoutContainerMaxWidth',
          'layoutGridGap',
          'layoutCardPadding',
          'layoutBorderRadius',
          'timezone',
          'rsvpDeadlineDate',
          'rsvpClosedMessage',
          'emailProvider',
          'smtpHost',
          'smtpUser',
          'smtpFrom',
          'resendFrom',
          'sendgridFrom',
          'smsProvider',
          'twilioAccountSid',
          'twilioFromNumber',
          'shippingRecipientName',
          'shippingAddressLine1',
          'shippingAddressLine2',
          'shippingCity',
          'shippingState',
          'shippingZip',
          'shippingCountry',
          'shippingPhone',
          'shippingDeliveryNotes',
          'defaultPaymentHandleType',
          'defaultPaymentHandle',
        ] as const;

        const configMap = config as unknown as Record<string, unknown>;
        for (const key of editableStringFields) {
          if (typeof body[key] === 'string') {
            configMap[key] = body[key];
          }
        }
        if (typeof body.latitude === 'number') config.latitude = body.latitude;
        if (typeof body.longitude === 'number') config.longitude = body.longitude;
        if (typeof body.showCountdown === 'boolean') {
          config.showCountdown = body.showCountdown;
        }
        if (typeof body.showAddToCalendar === 'boolean') {
          config.showAddToCalendar = body.showAddToCalendar;
        }
        if (typeof body.rsvpOpen === 'boolean') {
          config.rsvpOpen = body.rsvpOpen;
        }
        if (typeof body.rsvpGracePeriodHours === 'number') {
          config.rsvpGracePeriodHours = body.rsvpGracePeriodHours;
        }
        if (
          body.themeTokens &&
          typeof body.themeTokens === 'object' &&
          !Array.isArray(body.themeTokens)
        ) {
          config.themeTokens = body.themeTokens as Record<string, unknown>;
        }
        if (Array.isArray(body.features)) {
          config.features = body.features as typeof config.features;
        }
        if (
          body.modules &&
          typeof body.modules === 'object' &&
          !Array.isArray(body.modules)
        ) {
          config.modules = {
            ...config.modules,
            ...(body.modules as Partial<typeof config.modules>),
          };
        }
        config.updatedAt = new Date().toISOString();
        pushAuditVersion(draft, 'AppConfig', config.id, config);
        return toAdminConfigDto(config);
      });
      return wrapMiddlewareJson(updated);
    }

    if (method === 'DELETE') {
      return wrapMiddlewareJson({ deleted: true });
    }
  }

  if (pathname === '/api/admin/features') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const config = getActiveAppConfig(snapshot);
      return wrapMiddlewareJson({
        features: config.features,
        modules: config.modules,
      });
    }

    if (method === 'PUT' || method === 'POST') {
      const body = await readJsonBody(request);
      const result = store.mutate((draft) => {
        const config = getActiveAppConfig(draft);
        if (Array.isArray(body.features)) {
          config.features = body.features as typeof config.features;
        }
        if (
          body.modules &&
          typeof body.modules === 'object' &&
          !Array.isArray(body.modules)
        ) {
          config.modules = {
            ...config.modules,
            ...(body.modules as Partial<typeof config.modules>),
          };
        }
        config.updatedAt = new Date().toISOString();
        pushAuditVersion(draft, 'AppConfig', config.id, {
          current: config.features,
          modules: config.modules,
        });
        return {
          features: config.features,
          modules: config.modules,
        };
      });
      return wrapMiddlewareJson(result);
    }
  }

  // --- Admin File Upload & Media Library ---
  if (pathname === '/api/admin/upload' && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    let altText = 'Uploaded Image';
    let fileBlob: Blob | { name?: string } = { name: 'upload.jpg' };

    if (contentType.includes('multipart/form-data')) {
      try {
        const formData = await request.formData();
        const f = formData.get('file') ?? formData.get('files');
        const rawAlt = formData.get('altText') ?? formData.get('title');
        if (typeof rawAlt === 'string' && rawAlt.trim()) {
          altText = rawAlt.trim();
        }
        if (f && typeof f === 'object' && 'size' in f) {
          fileBlob = f as Blob;
          if ('name' in f && typeof f.name === 'string' && !rawAlt) {
            altText = f.name;
          }
        }
      } catch {
        fileBlob = { name: 'upload.jpg' };
      }
    } else {
      const body = await readJsonBody(request);
      if (typeof body.altText === 'string' && body.altText.trim()) {
        altText = body.altText.trim();
      }
    }

    const url = await createCompactUploadThumbnail(fileBlob, altText);
    const created = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const media = {
        id: generateDemoId('media'),
        url,
        altText,
        isDecorative: false,
        isSample: false,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.media.unshift(media);
      pushAuditVersion(draft, 'Media', media.id, media);
      return media;
    });

    return wrapMiddlewareJson(created, { status: 201 });
  }

  if (pathname === '/api/media') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const rawPage = parseInt(searchParams.get('page') || '1', 10);
      const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
      const page = Number.isFinite(rawPage) && rawPage >= 1 ? rawPage : 1;
      const limit =
        Number.isFinite(rawLimit) && rawLimit >= 1
          ? Math.min(rawLimit, 100)
          : 20;
      const sorted = [...snapshot.media].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      const total = sorted.length;
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
      const data = sorted.slice((page - 1) * limit, page * limit);
      return wrapMiddlewareJson({
        data,
        total,
        page,
        limit,
        totalPages,
      });
    }

    if (method === 'POST') {
      const body = await readJsonBody(request);
      const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
      if (!rawUrl) {
        return errorJson(400, 'Media URL is required');
      }
      const created = store.mutate((draft) => {
        const nowIso = new Date().toISOString();
        const media = {
          id: generateDemoId('media'),
          url: rawUrl,
          altText: typeof body.altText === 'string' ? body.altText : null,
          isDecorative: Boolean(body.isDecorative),
          isSample: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.media.unshift(media);
        pushAuditVersion(draft, 'Media', media.id, media);
        return media;
      });
      return wrapMiddlewareJson(created, { status: 201 });
    }
  }

  if (pathname === '/api/media/export' && (method === 'GET' || method === 'POST')) {
    if (method === 'POST') {
      const body = await readJsonBody(request);
      if (body.preflight) {
        return wrapMiddlewareJson({ ready: true });
      }
    } else if (searchParams.get('preflight') === '1') {
      return wrapMiddlewareJson({ ready: true });
    }
    const snapshot = store.getSnapshot();
    const encoder = new TextEncoder();
    const entries = snapshot.media.slice(0, 20).map((m, index) => ({
      filename: `media-${index + 1}-${m.id}.txt`,
      data: encoder.encode(`ID: ${m.id}\nAlt: ${m.altText ?? ''}\nURL: ${m.url}\n`),
    }));
    const zipBytes = buildStoredZipBytes(entries);
    return binaryResponse(zipBytes, 'application/zip', {
      'Content-Disposition': 'attachment; filename="wedding-media-export.zip"',
    });
  }

  const mediaIdMatch = pathname.match(/^\/api\/media\/([^/]+)$/);
  if (mediaIdMatch) {
    const mediaId = decodeURIComponent(mediaIdMatch[1]);
    if (method === 'GET') {
      const found = store.getSnapshot().media.find((m) => m.id === mediaId);
      return found ? wrapMiddlewareJson(found) : errorJson(404, 'Media not found');
    }
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) => {
        const found = draft.media.find((m) => m.id === mediaId);
        if (!found) return null;
        if (body.altText !== undefined) {
          found.altText = typeof body.altText === 'string' ? body.altText : null;
        }
        if (typeof body.isDecorative === 'boolean') {
          found.isDecorative = body.isDecorative;
        }
        if (typeof body.url === 'string' && body.url.trim()) {
          found.url = body.url.trim();
        }
        found.updatedAt = new Date().toISOString();
        pushAuditVersion(draft, 'Media', found.id, found);
        return { ...found };
      });
      return updated ? wrapMiddlewareJson(updated) : errorJson(404, 'Media not found');
    }
    if (method === 'DELETE') {
      const removed = store.mutate((draft) => {
        const idx = draft.media.findIndex((m) => m.id === mediaId);
        if (idx < 0) return false;
        const [del] = draft.media.splice(idx, 1);
        pushAuditVersion(draft, 'Media', mediaId, { deleted: true, previous: del });
        return true;
      });
      return removed
        ? wrapMiddlewareJson({ id: mediaId, deleted: true })
        : errorJson(404, 'Media not found');
    }
  }

  // --- Photo Moderation & Admin Photo CRUD ---
  if (
    pathname === '/api/admin/photos/moderation' ||
    pathname === '/api/admin/photos/moderation/batch'
  ) {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
      const limit = Math.min(
        100,
        Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
      );
      const pending = snapshot.contentNode
        .filter(
          (n) =>
            n.type.toUpperCase() === 'PHOTO' &&
            String(n.data?.status ?? '').toUpperCase() === 'PENDING',
        )
        .map((n) => toPhotoDto(snapshot, n));
      const total = pending.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const paged = pending.slice((page - 1) * limit, page * limit);
      return wrapMiddlewareJson({
        success: true,
        pendingCount: total,
        count: paged.length,
        photos: paged,
        data: paged,
        pagination: { page, limit, total, totalPages },
      });
    }

    if (method === 'PATCH' || method === 'POST') {
      const body = await readJsonBody(request);
      const batchIdsRaw =
        body.ids ?? body.photoIds ?? body.nodeIds ?? (Array.isArray(body.id) ? body.id : null);
      const ids: string[] = Array.isArray(batchIdsRaw)
        ? batchIdsRaw.filter((x): x is string => typeof x === 'string')
        : typeof (body.id ?? body.nodeId ?? body.photoId) === 'string'
          ? [String(body.id ?? body.nodeId ?? body.photoId)]
          : [];

      if (ids.length === 0) {
        return errorJson(400, 'Photo identifier is required');
      }

      const rawAction = String(body.action ?? body.status ?? 'approve').toLowerCase();
      const isApprove = rawAction === 'approve' || rawAction === 'approved';

      const moderated = store.mutate((draft) => {
        const updated: Array<Record<string, unknown>> = [];
        const nowIso = new Date().toISOString();
        for (const targetId of ids) {
          const node = draft.contentNode.find(
            (n) =>
              n.type.toUpperCase() === 'PHOTO' &&
              (n.id === targetId || n.data?.mediaId === targetId),
          );
          if (!node) continue;
          node.data = {
            ...node.data,
            status: isApprove ? 'APPROVED' : 'REJECTED',
            isVisible: isApprove,
          };
          node.updatedAt = nowIso;
          pushAuditVersion(draft, 'ContentNode', node.id, node);
          updated.push(toPhotoDto(draft, node));
        }
        return updated;
      });

      return wrapMiddlewareJson({
        success: true,
        count: moderated.length,
        updatedCount: moderated.length,
        message: `Photo${moderated.length === 1 ? '' : 's'} ${isApprove ? 'approved' : 'rejected'} successfully`,
        data: ids.length === 1 ? (moderated[0] ?? null) : moderated,
      });
    }
  }

  const adminPhotoMatch = pathname.match(/^\/api\/admin\/photos\/([^/]+)$/);
  if (adminPhotoMatch) {
    const photoId = decodeURIComponent(adminPhotoMatch[1]);
    if (method === 'PUT' || method === 'PATCH') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) => {
        const node = draft.contentNode.find(
          (n) =>
            n.type.toUpperCase() === 'PHOTO' &&
            (n.id === photoId || n.data?.mediaId === photoId),
        );
        if (!node) return null;
        node.data = {
          ...node.data,
          ...(typeof body.caption === 'string' ? { caption: body.caption } : {}),
          ...(typeof body.altText === 'string' ? { altText: body.altText } : {}),
          ...(typeof body.title === 'string' ? { title: body.title } : {}),
          ...(typeof body.category === 'string' ? { category: body.category } : {}),
          ...(typeof body.isVisible === 'boolean' ? { isVisible: body.isVisible } : {}),
        };
        node.updatedAt = new Date().toISOString();
        pushAuditVersion(draft, 'ContentNode', node.id, node);
        return toPhotoDto(draft, node);
      });
      return updated ? wrapMiddlewareJson(updated) : errorJson(404, 'Photo not found');
    }

    if (method === 'DELETE') {
      const deleted = store.mutate((draft) => {
        const idx = draft.contentNode.findIndex(
          (n) =>
            n.type.toUpperCase() === 'PHOTO' &&
            (n.id === photoId || n.data?.mediaId === photoId),
        );
        if (idx < 0) return false;
        const [removed] = draft.contentNode.splice(idx, 1);
        pushAuditVersion(draft, 'ContentNode', removed.id, {
          deleted: true,
          previous: removed,
        });
        return true;
      });
      return deleted
        ? wrapMiddlewareJson({ id: photoId, deleted: true })
        : errorJson(404, 'Photo not found');
    }
  }

  // --- Invitation Codes Workflows ---
  if (pathname === '/api/admin/invitation-codes/catalog' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const search = searchParams.get('search')?.trim().toLowerCase() || '';
    const orderBy = searchParams.get('orderBy')?.trim() || 'createdAt';
    const orderDir =
      searchParams.get('orderDir')?.trim().toLowerCase() === 'asc' ? 'asc' : 'desc';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      1000,
      Math.max(1, parseInt(searchParams.get('limit') || '1000', 10) || 1000),
    );
    const filtered = snapshot.invitationCode
      .filter((inv) => {
        if (!search) return true;
        return (
          inv.guestName.toLowerCase().includes(search) ||
          inv.code.toLowerCase().includes(search) ||
          (inv.householdName ?? '').toLowerCase().includes(search) ||
          (inv.partyGroup ?? '').toLowerCase().includes(search) ||
          (inv.dietaryNotes ?? '').toLowerCase().includes(search) ||
          (inv.email ?? '').toLowerCase().includes(search)
        );
      })
      .slice()
      .sort((a, b) => {
        const valA =
          orderBy === 'code'
            ? a.code
            : orderBy === 'guestName'
              ? a.guestName
              : orderBy === 'id'
                ? a.id
                : a.createdAt;
        const valB =
          orderBy === 'code'
            ? b.code
            : orderBy === 'guestName'
              ? b.guestName
              : orderBy === 'id'
                ? b.id
                : b.createdAt;
        const cmp = String(valA).localeCompare(String(valB));
        return orderDir === 'asc' ? cmp : -cmp;
      });
    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const items = filtered
      .slice((page - 1) * limit, page * limit)
      .map((inv) => ({
        ...inv,
        plusOneSeatNumbers: Array.isArray(inv.plusOneSeatNumbers)
          ? inv.plusOneSeatNumbers
          : [],
        subEventRsvps: toInvitationSubEventRsvps(snapshot, inv.id),
      }));
    return wrapMiddlewareJson(
      {
        items,
        total,
        page,
        limit,
        totalPages,
      },
      {
        headers: {
          'X-Total-Count': String(total),
          'X-Page': String(page),
          'X-Limit': String(limit),
          'X-Total-Pages': String(totalPages),
        },
      },
    );
  }

  if (
    (pathname === '/api/admin/invitation-codes/validate' ||
      pathname === '/api/admin/invitation-codes/batch/validate') &&
    method === 'POST'
  ) {
    const body = await readJsonBody(request);
    const records = Array.isArray(body.records) ? body.records : [];
    const snapshot = store.getSnapshot();
    const existingCodes = new Set(
      snapshot.invitationCode.map((i) => i.code.toUpperCase()),
    );
    const seenBatchCodes = new Set<string>();
    let invalidRows = 0;
    let duplicateCodes = 0;
    let dbCollisions = 0;

    const rows = records.map((raw, index) => {
      const rec =
        raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
      const guestName =
        typeof rec.guestName === 'string' ? rec.guestName.trim() : '';
      const code =
        typeof rec.code === 'string' ? rec.code.trim().toUpperCase() : '';
      const errors: string[] = [];
      const warnings: string[] = [];
      if (!guestName) {
        errors.push('Guest name is required.');
      }
      let hasCollision = false;
      if (code) {
        if (seenBatchCodes.has(code)) {
          duplicateCodes += 1;
          warnings.push(`Duplicate code ${code} in batch.`);
        }
        seenBatchCodes.add(code);
        if (existingCodes.has(code)) {
          hasCollision = true;
          dbCollisions += 1;
          warnings.push(`Code ${code} already exists.`);
        }
      }
      const isValid = errors.length === 0;
      if (!isValid) invalidRows += 1;
      return {
        ...rec,
        rowNumber: index + 1,
        isValid,
        errors,
        warnings,
        hasCollision,
      };
    });

    return wrapMiddlewareJson({
      success: true,
      summary: {
        totalRows: rows.length,
        validRows: rows.length - invalidRows,
        invalidRows,
        duplicateCodes,
        dbCollisions,
      },
      rows,
    });
  }

  if (pathname === '/api/admin/invitation-codes/batch' && method === 'POST') {
    const body = await readJsonBody(request);
    if (Array.isArray(body.ids)) {
      const ids = body.ids.filter((id): id is string => typeof id === 'string');
      const patch =
        body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          ? (body.payload as Record<string, unknown>)
          : body;
      const updated = store.mutate((draft) => {
        const list: DemoInvitationCodeRecord[] = [];
        const nowIso = new Date().toISOString();
        for (const id of ids) {
          const inv = draft.invitationCode.find((i) => i.id === id);
          if (!inv) continue;
          if (Array.isArray(patch.partyTags)) {
            inv.partyTags = patch.partyTags.filter(
              (t): t is string => typeof t === 'string',
            );
          }
          if (typeof patch.partyGroup === 'string') {
            inv.partyGroup = patch.partyGroup;
          }
          if (patch.plusOneAllocations !== undefined) {
            inv.plusOneAllocations = Math.max(
              0,
              Number(patch.plusOneAllocations) || 0,
            );
          }
          inv.updatedAt = nowIso;
          list.push({ ...inv });
        }
        return list;
      });
      return wrapMiddlewareJson({
        success: true,
        count: ids.length,
        updatedCount: ids.length,
        records: updated,
      });
    }

    const rawRecords = Array.isArray(body.records) ? body.records : [];
    const strategy =
      typeof body.collisionStrategy === 'string'
        ? body.collisionStrategy
        : 'skip';

    const outcome = store.mutate((draft) => {
      let imported = 0;
      let skipped = 0;
      let updatedCount = 0;
      const saved: DemoInvitationCodeRecord[] = [];
      const nowIso = new Date().toISOString();

      rawRecords.forEach((raw, idx) => {
        if (!raw || typeof raw !== 'object') return;
        const entry = raw as Record<string, unknown>;
        const guestName =
          typeof entry.guestName === 'string' && entry.guestName.trim()
            ? entry.guestName.trim()
            : '';
        if (!guestName) {
          skipped += 1;
          return;
        }
        const code =
          typeof entry.code === 'string' && entry.code.trim()
            ? entry.code.trim().toUpperCase()
            : `IMP${Date.now().toString(36).slice(-4).toUpperCase()}${idx + 1}`;

        const existing = draft.invitationCode.find(
          (i) => i.code.toUpperCase() === code,
        );
        if (existing) {
          if (strategy === 'overwrite' || strategy === 'update') {
            existing.guestName = guestName;
            if (typeof entry.email === 'string') existing.email = entry.email;
            if (typeof entry.householdName === 'string') {
              existing.householdName = entry.householdName;
            }
            existing.updatedAt = nowIso;
            updatedCount += 1;
            saved.push({ ...existing });
          } else {
            skipped += 1;
          }
          return;
        }

        const created: DemoInvitationCodeRecord = {
          id: generateDemoId('inv'),
          code,
          guestName,
          email:
            typeof entry.email === 'string' && entry.email.trim()
              ? entry.email.trim()
              : null,
          addressLine1:
            typeof entry.addressLine1 === 'string' ? entry.addressLine1 : null,
          addressLine2:
            typeof entry.addressLine2 === 'string' ? entry.addressLine2 : null,
          city: typeof entry.city === 'string' ? entry.city : null,
          state: typeof entry.state === 'string' ? entry.state : null,
          zipCode: typeof entry.zipCode === 'string' ? entry.zipCode : null,
          country:
            typeof entry.country === 'string' ? entry.country : 'United States',
          dietaryNotes:
            typeof entry.dietaryNotes === 'string' ? entry.dietaryNotes : null,
          plusOneAllocations: Math.max(
            0,
            Number(entry.plusOneAllocations ?? 0) || 0,
          ),
          plusOneFirstName: null,
          plusOneLastName: null,
          householdName:
            typeof entry.householdName === 'string'
              ? entry.householdName
              : guestName,
          partyGroup:
            typeof entry.partyGroup === 'string' ? entry.partyGroup : null,
          partyTags: Array.isArray(entry.partyTags)
            ? entry.partyTags.filter((t): t is string => typeof t === 'string')
            : [],
          extraFields: null,
          used: false,
          usedAt: null,
          tableId: null,
          seatNumber: null,
          plusOneSeatNumbers: [],
          isSample: false,
          createdAt: nowIso,
          updatedAt: nowIso,
        };
        draft.invitationCode.push(created);
        imported += 1;
        saved.push(created);
      });

      return { imported, skipped, updatedCount, saved };
    });

    return wrapMiddlewareJson({
      success: true,
      count: outcome.imported + outcome.updatedCount,
      imported: outcome.imported,
      skipped: outcome.skipped,
      updated: outcome.updatedCount,
      records: outcome.saved,
    });
  }

  if (pathname === '/api/admin/invitation-codes/merge' && method === 'POST') {
    const body = await readJsonBody(request);
    const primaryId =
      typeof body.primaryId === 'string' ? body.primaryId.trim() : '';
    const secondaryIds = Array.isArray(body.secondaryIds)
      ? body.secondaryIds.filter((id): id is string => typeof id === 'string')
      : [];

    if (!primaryId) {
      return errorJson(400, 'Primary invitation ID is required');
    }

    const merged = store.mutate((draft) => {
      const primary = draft.invitationCode.find((i) => i.id === primaryId);
      if (!primary) {
        return {
          record: {
            id: primaryId,
            code: 'MERGED01',
            guestName: 'Merged Guest',
            used: false,
            partyTags: [],
          },
          mergedCount: secondaryIds.length,
          transferredCounts: {
            contributors: 0,
            subEventAccesses: 0,
            subEventRsvps: 0,
            broadcastRecipients: 0,
            seatTransferred: false,
          },
        };
      }

      const secSet = new Set(secondaryIds.filter((id) => id !== primaryId));
      let contributors = 0;
      let subEventAccesses = 0;
      let subEventRsvps = 0;
      let broadcastRecipients = 0;
      let seatTransferred = false;

      for (const secId of secSet) {
        const sec = draft.invitationCode.find((i) => i.id === secId);
        if (!sec) continue;
        if (!primary.email && sec.email) primary.email = sec.email;
        if (!primary.addressLine1 && sec.addressLine1) {
          primary.addressLine1 = sec.addressLine1;
          primary.city = sec.city;
          primary.state = sec.state;
          primary.zipCode = sec.zipCode;
        }
        if (!primary.tableId && sec.tableId) {
          primary.tableId = sec.tableId;
          primary.seatNumber = sec.seatNumber;
          primary.plusOneSeatNumbers = Array.isArray(sec.plusOneSeatNumbers)
            ? [...sec.plusOneSeatNumbers]
            : [];
          seatTransferred = true;
        }
        primary.partyTags = Array.from(
          new Set([...primary.partyTags, ...sec.partyTags]),
        );
      }

      for (const c of draft.contributor) {
        if (c.invitationCodeId && secSet.has(c.invitationCodeId)) {
          c.invitationCodeId = primary.id;
          contributors += 1;
        }
      }
      for (const acc of draft.subEventAccess) {
        if (secSet.has(acc.invitationCodeId)) {
          if (
            !draft.subEventAccess.some(
              (a) =>
                a.subEventId === acc.subEventId &&
                a.invitationCodeId === primary.id,
            )
          ) {
            acc.invitationCodeId = primary.id;
            subEventAccesses += 1;
          }
        }
      }
      for (const rsvp of draft.subEventRsvp) {
        if (secSet.has(rsvp.invitationCodeId)) {
          if (
            !draft.subEventRsvp.some(
              (r) =>
                r.subEventId === rsvp.subEventId &&
                r.invitationCodeId === primary.id,
            )
          ) {
            rsvp.invitationCodeId = primary.id;
            subEventRsvps += 1;
          }
        }
      }
      for (const br of draft.broadcastRecipient) {
        if (br.invitationCodeId && secSet.has(br.invitationCodeId)) {
          br.invitationCodeId = primary.id;
          broadcastRecipients += 1;
        }
      }

      const beforeLen = draft.invitationCode.length;
      draft.invitationCode = draft.invitationCode.filter(
        (i) => !secSet.has(i.id),
      );
      draft.subEventAccess = draft.subEventAccess.filter(
        (a) => !secSet.has(a.invitationCodeId),
      );
      draft.subEventRsvp = draft.subEventRsvp.filter(
        (r) => !secSet.has(r.invitationCodeId),
      );
      primary.updatedAt = new Date().toISOString();
      pushAuditVersion(draft, 'InvitationCode', primary.id, primary);

      return {
        record: { ...primary },
        mergedCount: beforeLen - draft.invitationCode.length,
        transferredCounts: {
          contributors,
          subEventAccesses,
          subEventRsvps,
          broadcastRecipients,
          seatTransferred,
        },
      };
    });

    return wrapMiddlewareJson({
      success: true,
      ...merged,
    });
  }

  if (pathname === '/api/admin/invitation-codes/rsvps') {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const invitationCodeId =
        searchParams.get('invitationCodeId') || 'inv-mock';
      const invite = snapshot.invitationCode.find(
        (i) => i.id === invitationCodeId,
      );
      if (!invite) {
        return wrapMiddlewareJson({
          invitationCode: {
            id: invitationCodeId,
            code: 'MOCKCODE',
            guestName: 'Mock Guest',
            plusOneAllocations: 1,
            dietaryNotes: '',
            used: false,
            partyTags: [],
          },
          subEvents: snapshot.subEvent,
          rsvps: [],
        });
      }
      const rsvps = snapshot.subEventRsvp.filter(
        (r) => r.invitationCodeId === invite.id,
      );
      return wrapMiddlewareJson({
        invitationCode: invite,
        subEvents: snapshot.subEvent,
        rsvps,
      });
    }

    if (method === 'PUT') {
      const body = await readJsonBody(request);
      if (Array.isArray(body.invitationCodeIds)) {
        const ids = body.invitationCodeIds.filter(
          (id): id is string => typeof id === 'string',
        );
        const subEventId =
          typeof body.subEventId === 'string' ? body.subEventId : '';
        const rawStatus =
          typeof body.status === 'string'
            ? body.status.toLowerCase()
            : 'attending';
        const status: DemoRsvpStatus =
          rawStatus === 'declined' || rawStatus === 'pending'
            ? rawStatus
            : 'attending';

        const updatedRecords = store.mutate((draft) => {
          const nowIso = new Date().toISOString();
          const targetEventIds = subEventId
            ? [subEventId]
            : draft.subEvent.map((e) => e.id);
          const touched: DemoSubEventRsvpRecord[] = [];

          for (const invId of ids) {
            const inv = draft.invitationCode.find((i) => i.id === invId);
            if (inv) {
              inv.used = status !== 'pending';
              inv.updatedAt = nowIso;
            }
            for (const evId of targetEventIds) {
              const idx = draft.subEventRsvp.findIndex(
                (r) => r.invitationCodeId === invId && r.subEventId === evId,
              );
              const rec: DemoSubEventRsvpRecord = {
                id: idx >= 0 ? draft.subEventRsvp[idx].id : generateDemoId('rsvp'),
                subEventId: evId,
                invitationCodeId: invId,
                status,
                plusOneCount: idx >= 0 ? draft.subEventRsvp[idx].plusOneCount : 0,
                dietaryNotes: idx >= 0 ? draft.subEventRsvp[idx].dietaryNotes : '',
                mealSelections:
                  idx >= 0 ? draft.subEventRsvp[idx].mealSelections : [],
                customAnswers:
                  idx >= 0 ? draft.subEventRsvp[idx].customAnswers : {},
                plusOneNames: idx >= 0 ? draft.subEventRsvp[idx].plusOneNames : [],
                createdAt:
                  idx >= 0 ? draft.subEventRsvp[idx].createdAt : nowIso,
                updatedAt: nowIso,
              };
              if (idx >= 0) draft.subEventRsvp[idx] = rec;
              else draft.subEventRsvp.push(rec);
              touched.push(rec);
            }
          }
          return touched;
        });

        return wrapMiddlewareJson({
          updatedCount: ids.length,
          records: updatedRecords,
        });
      }

      const invitationCodeId =
        typeof body.invitationCodeId === 'string'
          ? body.invitationCodeId
          : 'inv-mock';
      const result = store.mutate((draft) => {
        const inv = draft.invitationCode.find((i) => i.id === invitationCodeId);
        const nowIso = new Date().toISOString();
        const incomingRsvps = Array.isArray(body.rsvps) ? body.rsvps : [];

        for (const raw of incomingRsvps) {
          if (!raw || typeof raw !== 'object') continue;
          const entry = raw as Record<string, unknown>;
          const evId =
            typeof entry.subEventId === 'string' ? entry.subEventId : '';
          if (!evId) continue;
          const stRaw =
            typeof entry.status === 'string'
              ? entry.status.toLowerCase()
              : 'attending';
          const status: DemoRsvpStatus =
            stRaw === 'declined' || stRaw === 'pending' ? stRaw : 'attending';
          const idx = draft.subEventRsvp.findIndex(
            (r) =>
              r.invitationCodeId === invitationCodeId && r.subEventId === evId,
          );
          const rec: DemoSubEventRsvpRecord = {
            id: idx >= 0 ? draft.subEventRsvp[idx].id : generateDemoId('rsvp'),
            subEventId: evId,
            invitationCodeId,
            status,
            plusOneCount: Math.max(0, Number(entry.plusOneCount ?? 0) || 0),
            dietaryNotes:
              typeof entry.dietaryNotes === 'string' ? entry.dietaryNotes : '',
            mealSelections: Array.isArray(entry.mealSelections)
              ? entry.mealSelections.filter(
                (m): m is string => typeof m === 'string',
              )
              : [],
            customAnswers:
              entry.customAnswers &&
              typeof entry.customAnswers === 'object' &&
              !Array.isArray(entry.customAnswers)
                ? (entry.customAnswers as Record<string, unknown>)
                : {},
            plusOneNames: Array.isArray(entry.plusOneNames)
              ? entry.plusOneNames.filter(
                (n): n is string => typeof n === 'string',
              )
              : [],
            createdAt: idx >= 0 ? draft.subEventRsvp[idx].createdAt : nowIso,
            updatedAt: nowIso,
          };
          if (idx >= 0) draft.subEventRsvp[idx] = rec;
          else draft.subEventRsvp.push(rec);
        }

        if (inv) {
          inv.used = true;
          if (typeof body.dietaryNotes === 'string') {
            inv.dietaryNotes = body.dietaryNotes;
          }
          inv.updatedAt = nowIso;
        }

        return {
          invitationCode: inv ?? {
            id: invitationCodeId,
            code: 'MOCKCODE',
            guestName: 'Mock Guest',
            plusOneAllocations: 1,
            dietaryNotes: '',
            used: true,
            partyTags: [],
          },
          subEvents: draft.subEvent,
          rsvps: draft.subEventRsvp.filter(
            (r) => r.invitationCodeId === invitationCodeId,
          ),
        };
      });

      return wrapMiddlewareJson(result);
    }
  }

  if (pathname === '/api/admin/invitation-codes/export' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const csv = buildInvitationCodesCsv(
      snapshot.invitationCode,
      snapshot.seatingTable,
    );
    return binaryResponse(csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="guest-invitations.csv"',
    });
  }

  // --- Sub-Event Access & RSVP Summary ---
  if (
    pathname === '/api/admin/sub-events/access' ||
    pathname === '/api/admin/sub-events/access/batch'
  ) {
    if (method === 'GET') {
      const snapshot = store.getSnapshot();
      const subEvents = snapshot.subEvent.map((ev) => ({
        ...ev,
        accesses: snapshot.subEventAccess.filter((a) => a.subEventId === ev.id),
      }));
      const invitationCodes = snapshot.invitationCode.map((inv) => ({
        ...inv,
        subEventAccesses: snapshot.subEventAccess.filter(
          (a) => a.invitationCodeId === inv.id,
        ),
      }));
      return wrapMiddlewareJson({
        subEvents,
        invitationCodes,
        accesses: snapshot.subEventAccess,
      });
    }

    if (method === 'POST' || method === 'PUT') {
      const body = await readJsonBody(request);
      const subEventId =
        typeof body.subEventId === 'string' ? body.subEventId : '';
      const invIds = Array.isArray(body.invitationCodeIds)
        ? body.invitationCodeIds.filter(
          (id): id is string => typeof id === 'string',
        )
        : typeof body.invitationCodeId === 'string'
          ? [body.invitationCodeId]
          : [];
      const grant = body.grant !== false && body.action !== 'revoke';

      const count = store.mutate((draft) => {
        const nowIso = new Date().toISOString();
        let changed = 0;
        for (const invId of invIds) {
          const idx = draft.subEventAccess.findIndex(
            (a) => a.subEventId === subEventId && a.invitationCodeId === invId,
          );
          if (grant && idx < 0 && subEventId) {
            draft.subEventAccess.push({
              id: generateDemoId('acc'),
              subEventId,
              invitationCodeId: invId,
              createdAt: nowIso,
            });
            changed += 1;
          } else if (!grant && idx >= 0) {
            draft.subEventAccess.splice(idx, 1);
            changed += 1;
          }
        }
        return changed;
      });

      return wrapMiddlewareJson({ success: true, count, updatedCount: count });
    }

    if (method === 'DELETE') {
      const body = await readJsonBody(request);
      const subEventId =
        searchParams.get('subEventId') ||
        (typeof body.subEventId === 'string' ? body.subEventId : '');
      const invitationCodeId =
        searchParams.get('invitationCodeId') ||
        (typeof body.invitationCodeId === 'string' ? body.invitationCodeId : '');
      store.mutate((draft) => {
        draft.subEventAccess = draft.subEventAccess.filter(
          (a) =>
            !(
              a.subEventId === subEventId &&
              a.invitationCodeId === invitationCodeId
            ),
        );
      });
      return wrapMiddlewareJson({ success: true });
    }
  }

  if (pathname === '/api/admin/sub-events/rsvp-summary' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const invitations = snapshot.invitationCode;
    let attendingHouseholds = 0;
    let declinedHouseholds = 0;
    let pendingHouseholds = 0;
    let attendingHeadcount = 0;
    let attendingPlusOnes = 0;
    let declinedHeadcount = 0;
    let pendingHeadcount = 0;

    const dietary = {
      totalWithRestrictions: 0,
      glutenFree: 0,
      vegetarian: 0,
      vegan: 0,
      dairyFree: 0,
      nutFree: 0,
      halal: 0,
      kosher: 0,
      other: 0,
      kids: 0,
    };

    for (const inv of invitations) {
      const invRsvps = snapshot.subEventRsvp.filter(
        (r) => r.invitationCodeId === inv.id,
      );
      const hasAttending = invRsvps.some((r) => r.status === 'attending');
      const allDeclined =
        invRsvps.length > 0 && invRsvps.every((r) => r.status === 'declined');
      const maxPlusOnes = invRsvps.reduce(
        (mx, r) => (r.status === 'attending' ? Math.max(mx, r.plusOneCount) : mx),
        0,
      );

      if (hasAttending) {
        attendingHouseholds += 1;
        attendingPlusOnes += maxPlusOnes;
        attendingHeadcount += 1 + maxPlusOnes;
      } else if (allDeclined) {
        declinedHouseholds += 1;
        declinedHeadcount += 1;
      } else {
        pendingHouseholds += 1;
        pendingHeadcount += 1 + (inv.plusOneAllocations || 0);
      }

      const notes = [
        inv.dietaryNotes,
        ...invRsvps.map((r) => r.dietaryNotes),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (notes.trim()) {
        dietary.totalWithRestrictions += 1;
        if (notes.includes('gluten')) dietary.glutenFree += 1;
        if (notes.includes('vegetarian')) dietary.vegetarian += 1;
        if (notes.includes('vegan')) dietary.vegan += 1;
        if (notes.includes('dairy')) dietary.dairyFree += 1;
        if (notes.includes('nut')) dietary.nutFree += 1;
      }
    }

    const subEventSummaries = snapshot.subEvent.map((ev) => {
      const rsvps = snapshot.subEventRsvp.filter((r) => r.subEventId === ev.id);
      const attending = rsvps.filter((r) => r.status === 'attending');
      const declined = rsvps.filter((r) => r.status === 'declined');
      const plusOnes = attending.reduce((s, r) => s + r.plusOneCount, 0);
      return {
        id: ev.id,
        subEventId: ev.id,
        title: ev.title,
        attendingHouseholds: attending.length,
        attendingHeadcount: attending.length + plusOnes,
        attendingPlusOnes: plusOnes,
        declinedHouseholds: declined.length,
        pendingHouseholds: Math.max(
          0,
          invitations.length - attending.length - declined.length,
        ),
      };
    });

    return wrapMiddlewareJson({
      global: {
        totalInvitations: invitations.length,
        attendingHouseholds,
        declinedHouseholds,
        pendingHouseholds,
        attendingHeadcount,
        attendingPlusOnes,
        declinedHeadcount,
        pendingHeadcount,
        dietary,
        mealTotals: [],
        questionBreakdowns: [],
      },
      subEvents: subEventSummaries,
    });
  }

  // --- Seating Chart Workflows ---
  if (pathname === '/api/admin/seating/assign' && method === 'POST') {
    const body = await readJsonBody(request);
    const snapshotBefore = store.getSnapshot();

    const computePartyChairs = (
      snap: StaticDemoSnapshot,
      inv: DemoInvitationCodeRecord,
    ): number => {
      const rsvps = snap.subEventRsvp.filter((r) => r.invitationCodeId === inv.id);
      if (rsvps.length > 0 && rsvps.every((r) => r.status === 'declined')) {
        return 1;
      }
      const maxRsvpPlusOnes = rsvps.reduce(
        (max, r) => (r.status === 'declined' ? max : Math.max(max, r.plusOneCount ?? 0)),
        0,
      );
      return 1 + Math.max(maxRsvpPlusOnes, inv.plusOneAllocations ?? 0);
    };

    const collectOccupiedSeats = (
      snap: StaticDemoSnapshot,
      tableId: string,
      excludedIds: Set<string>,
    ): Set<number> => {
      const occupied = new Set<number>();
      for (const inv of snap.invitationCode) {
        if (inv.tableId !== tableId || excludedIds.has(inv.id)) continue;
        if (typeof inv.seatNumber === 'number' && inv.seatNumber > 0) {
          occupied.add(inv.seatNumber);
        }
        if (Array.isArray(inv.plusOneSeatNumbers)) {
          for (const s of inv.plusOneSeatNumbers) {
            if (typeof s === 'number' && s > 0) occupied.add(s);
          }
        }
      }
      return occupied;
    };

    const targetTableCheckId =
      typeof body.tableId === 'string' && body.tableId ? body.tableId : null;
    if (targetTableCheckId) {
      const targetTbl = snapshotBefore.seatingTable.find(
        (t) => t.id === targetTableCheckId,
      );
      if (!targetTbl) {
        return errorJson(400, 'Validation Error: Table not found.');
      }
      if (isDemoLandmarkShape(targetTbl.shape) || targetTbl.capacity <= 0) {
        return errorJson(
          400,
          `Validation Error: Cannot assign guests to landmark "${targetTbl.name}".`,
        );
      }
    }

    if (Array.isArray(body.assignments)) {
      for (const raw of body.assignments) {
        if (!raw || typeof raw !== 'object') continue;
        const entryTableId =
          typeof (raw as Record<string, unknown>).tableId === 'string'
            ? ((raw as Record<string, unknown>).tableId as string)
            : '';
        if (!entryTableId) continue;
        const tbl = snapshotBefore.seatingTable.find((t) => t.id === entryTableId);
        if (tbl && (isDemoLandmarkShape(tbl.shape) || tbl.capacity <= 0)) {
          return errorJson(
            400,
            `Validation Error: Cannot assign guests to landmark "${tbl.name}".`,
          );
        }
      }
    }

    const result = store.mutate((draft) => {
      const nowIso = new Date().toISOString();

      if (Array.isArray(body.assignments)) {
        const updated: Array<Record<string, unknown>> = [];
        for (const raw of body.assignments) {
          if (!raw || typeof raw !== 'object') continue;
          const entry = raw as Record<string, unknown>;
          const inv = draft.invitationCode.find(
            (i) => i.id === entry.invitationCodeId,
          );
          if (!inv) continue;
          const nextTableId =
            typeof entry.tableId === 'string' && entry.tableId
              ? entry.tableId
              : null;
          inv.tableId = nextTableId;
          inv.seatNumber =
            nextTableId && typeof entry.seatNumber === 'number'
              ? entry.seatNumber
              : null;
          inv.plusOneSeatNumbers =
            nextTableId && Array.isArray(entry.plusOneSeatNumbers)
              ? entry.plusOneSeatNumbers.filter(
                (n): n is number =>
                  typeof n === 'number' && Number.isInteger(n) && n > 0,
              )
              : [];
          inv.updatedAt = nowIso;
          updated.push(toInvitationCodeDto(draft, inv));
        }
        return {
          kind: 'batch' as const,
          payload: {
            assignedCount: updated.length,
            updatedGuests: updated,
            records: updated,
          },
        };
      }

      if (Array.isArray(body.invitationCodeIds)) {
        const tableId =
          typeof body.tableId === 'string' && body.tableId ? body.tableId : null;
        const batchIds = body.invitationCodeIds.filter(
          (id): id is string => typeof id === 'string',
        );
        const batchSet = new Set(batchIds);
        const updated: Array<Record<string, unknown>> = [];
        const occupied = tableId
          ? collectOccupiedSeats(draft, tableId, batchSet)
          : new Set<number>();
        let nextSeat = 1;
        for (const id of batchIds) {
          const inv = draft.invitationCode.find((i) => i.id === id);
          if (!inv) continue;
          inv.tableId = tableId;
          if (tableId) {
            const needed = computePartyChairs(draft, inv);
            while (occupied.has(nextSeat)) nextSeat += 1;
            inv.seatNumber = nextSeat;
            occupied.add(nextSeat);
            const plusSeats: number[] = [];
            for (let p = 1; p < needed; p += 1) {
              while (occupied.has(nextSeat)) nextSeat += 1;
              plusSeats.push(nextSeat);
              occupied.add(nextSeat);
            }
            inv.plusOneSeatNumbers = plusSeats;
          } else {
            inv.seatNumber = null;
            inv.plusOneSeatNumbers = [];
          }
          inv.updatedAt = nowIso;
          updated.push(toInvitationCodeDto(draft, inv));
        }
        return {
          kind: 'batch' as const,
          payload: {
            assignedCount: updated.length,
            updatedGuests: updated,
            records: updated,
          },
        };
      }

      const invitationCodeId =
        typeof body.invitationCodeId === 'string' ? body.invitationCodeId : '';
      const inv = draft.invitationCode.find((i) => i.id === invitationCodeId);
      if (!inv) return null;
      const tableId =
        typeof body.tableId === 'string' && body.tableId ? body.tableId : null;
      inv.tableId = tableId;
      if (tableId) {
        const occupied = collectOccupiedSeats(
          draft,
          tableId,
          new Set([inv.id]),
        );
        if (typeof body.seatNumber === 'number' && body.seatNumber > 0) {
          inv.seatNumber = body.seatNumber;
          occupied.add(body.seatNumber);
        } else {
          let seat = 1;
          while (occupied.has(seat)) seat += 1;
          inv.seatNumber = seat;
          occupied.add(seat);
        }

        if (Array.isArray(body.plusOneSeatNumbers)) {
          inv.plusOneSeatNumbers = body.plusOneSeatNumbers.filter(
            (n): n is number =>
              typeof n === 'number' &&
              Number.isInteger(n) &&
              n > 0 &&
              n !== inv.seatNumber,
          );
        } else {
          const plusOneCount = Math.max(0, computePartyChairs(draft, inv) - 1);
          const plusSeats: number[] = [];
          let candidate = 1;
          for (let p = 0; p < plusOneCount; p += 1) {
            while (occupied.has(candidate)) candidate += 1;
            plusSeats.push(candidate);
            occupied.add(candidate);
          }
          inv.plusOneSeatNumbers = plusSeats;
        }
      } else {
        inv.seatNumber = null;
        inv.plusOneSeatNumbers = [];
      }
      inv.updatedAt = nowIso;
      pushAuditVersion(draft, 'InvitationCode', inv.id, inv);
      return {
        kind: 'single' as const,
        payload: {
          ...toInvitationCodeDto(draft, inv),
          invitationCode: { ...inv },
          assignedCount: 1,
        },
      };
    });

    if (!result) {
      return errorJson(404, 'Guest invitation not found');
    }
    return wrapMiddlewareJson(result.payload);
  }

  if (pathname === '/api/admin/seating/auto-assign' && method === 'POST') {
    const body = await readJsonBody(request);
    const includePending = body.includePending !== false;
    const filterGroup =
      typeof body.partyGroup === 'string' && body.partyGroup.trim()
        ? body.partyGroup.trim().toLowerCase()
        : null;
    const filterTags = Array.isArray(body.partyTags)
      ? body.partyTags
        .filter((t): t is string => typeof t === 'string' && Boolean(t.trim()))
        .map((t) => t.trim().toLowerCase())
      : [];

    const result = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const guestTables = draft.seatingTable.filter(
        (t) => !isDemoLandmarkShape(t.shape) && t.capacity > 0,
      );

      const getPartyChairs = (inv: DemoInvitationCodeRecord): number => {
        const rsvps = draft.subEventRsvp.filter((r) => r.invitationCodeId === inv.id);
        const maxRsvpPlusOnes = rsvps.reduce(
          (max, r) =>
            r.status === 'declined' ? max : Math.max(max, r.plusOneCount ?? 0),
          0,
        );
        return 1 + Math.max(maxRsvpPlusOnes, inv.plusOneAllocations ?? 0);
      };

      const isEligible = (inv: DemoInvitationCodeRecord): boolean => {
        if (
          inv.partyTags.some(
            (tag) => tag.trim().toLowerCase() === 'address-collection',
          )
        ) {
          return false;
        }
        const rsvps = draft.subEventRsvp.filter((r) => r.invitationCodeId === inv.id);
        if (rsvps.length > 0 && rsvps.every((r) => r.status === 'declined')) {
          return false;
        }
        const isAttending =
          rsvps.some((r) => r.status === 'attending') || Boolean(inv.used);
        if (!includePending && !isAttending) {
          return false;
        }
        if (filterGroup && (inv.partyGroup ?? '').trim().toLowerCase() !== filterGroup) {
          return false;
        }
        if (
          filterTags.length > 0 &&
          !inv.partyTags.some((t) => filterTags.includes(t.trim().toLowerCase()))
        ) {
          return false;
        }
        return true;
      };

      const unseated = draft.invitationCode.filter(
        (i) => !i.tableId && isEligible(i),
      );
      const assignedGuests: Array<Record<string, unknown>> = [];

      for (const guest of unseated) {
        const neededChairs = getPartyChairs(guest);
        for (const table of guestTables) {
          const seatedHere = draft.invitationCode.filter(
            (i) => i.tableId === table.id,
          );
          const usedChairsCount = seatedHere.reduce(
            (sum, i) => sum + getPartyChairs(i),
            0,
          );
          if (usedChairsCount + neededChairs <= table.capacity) {
            const taken = new Set<number>();
            for (const occ of seatedHere) {
              if (typeof occ.seatNumber === 'number') taken.add(occ.seatNumber);
              for (const s of occ.plusOneSeatNumbers ?? []) {
                if (typeof s === 'number') taken.add(s);
              }
            }
            let seat = 1;
            while (taken.has(seat)) seat += 1;
            guest.tableId = table.id;
            guest.seatNumber = seat;
            taken.add(seat);
            const plusSeats: number[] = [];
            for (let p = 1; p < neededChairs; p += 1) {
              while (taken.has(seat)) seat += 1;
              plusSeats.push(seat);
              taken.add(seat);
            }
            guest.plusOneSeatNumbers = plusSeats;
            guest.updatedAt = nowIso;
            assignedGuests.push(toInvitationCodeDto(draft, guest));
            break;
          }
        }
      }

      const remainingUnassigned = draft.invitationCode.filter(
        (i) => !i.tableId && isEligible(i),
      ).length;
      return {
        assignedCount: assignedGuests.length,
        unassignedCount: remainingUnassigned,
        assignedGuests,
      };
    });

    return wrapMiddlewareJson(result);
  }

  if (pathname === '/api/admin/seating/export' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const format = (searchParams.get('format') || 'csv').toLowerCase();
    const guestTables = snapshot.seatingTable.filter(
      (t) => !isDemoLandmarkShape(t.shape) && t.capacity > 0,
    );
    const dateStamp = new Date().toISOString().slice(0, 10);

    if (format === 'pdf') {
      const lines = guestTables.flatMap((t) => {
        const guests = snapshot.invitationCode.filter((i) => i.tableId === t.id);
        return [
          `${t.name} (${guests.length}/${t.capacity} seated):`,
          ...guests.map((g) => {
            const po =
              Array.isArray(g.plusOneSeatNumbers) && g.plusOneSeatNumbers.length > 0
                ? ` (+1 seats: ${g.plusOneSeatNumbers.join(', ')})`
                : '';
            return `  Seat ${g.seatNumber ?? '-'}: ${g.guestName}${po}`;
          }),
        ];
      });
      const pdf = buildSimplePdfBytes('Reception Seating Chart', lines);
      return binaryResponse(pdf, 'application/pdf', {
        'Content-Disposition': 'attachment; filename="seating-chart.pdf"',
      });
    }

    if (format === 'place-cards' || format === 'escort-cards') {
      const cardTitle =
        format === 'place-cards'
          ? 'Reception Place Cards'
          : 'Reception Escort Cards';
      const filename =
        format === 'place-cards'
          ? 'seating-place-cards.pdf'
          : 'seating-escort-cards.pdf';
      const lines = guestTables.flatMap((t) => {
        const guests = snapshot.invitationCode.filter((i) => i.tableId === t.id);
        return guests.flatMap((g) => {
          const baseLine = `${g.guestName} - ${t.name}, Seat ${g.seatNumber ?? '-'}`;
          const companionSeats = Array.isArray(g.plusOneSeatNumbers)
            ? g.plusOneSeatNumbers
            : [];
          const companionName =
            [g.plusOneFirstName, g.plusOneLastName].filter(Boolean).join(' ') ||
            `${g.guestName} Guest`;
          return [
            baseLine,
            ...companionSeats.map(
              (s) => `${companionName} - ${t.name}, Seat ${s}`,
            ),
          ];
        });
      });
      const pdf = buildSimplePdfBytes(cardTitle, lines);
      return binaryResponse(pdf, 'application/pdf', {
        'Content-Disposition': `attachment; filename="${filename}"`,
      });
    }

    if (format === 'meals' || format === 'meal-counts') {
      const mealCsv = buildSeatingMealCountsCsv(snapshot);
      return binaryResponse(mealCsv, 'text/csv; charset=utf-8', {
        'Content-Disposition': `attachment; filename="seating-meal-counts-${dateStamp}.csv"`,
      });
    }

    const csv = buildSeatingCsv(
      snapshot.seatingTable,
      snapshot.invitationCode,
      snapshot,
    );
    return binaryResponse(csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': `attachment; filename="seating-roster-${dateStamp}.csv"`,
    });
  }

  // --- Registry Item Unclaim & Thank-You Notes & Contributor Actions ---
  const registryUnclaimMatch = pathname.match(
    /^\/api\/admin\/registry\/items\/([^/]+)\/unclaim$/,
  );
  if (registryUnclaimMatch && method === 'POST') {
    const itemId = decodeURIComponent(registryUnclaimMatch[1]).trim();
    if (!itemId) {
      return errorJson(400, 'Registry item ID is required');
    }

    const unclaimed = store.mutate((draft) => {
      const item = draft.registryItem.find((r) => r.id === itemId);
      if (!item) return null;
      const nowIso = new Date().toISOString();
      for (const c of draft.contributor) {
        if (
          c.registryItemId === itemId &&
          (c.status === 'RESERVED' || c.status === 'CONFIRMED')
        ) {
          c.status = 'CANCELLED';
          c.updatedAt = nowIso;
        }
      }
      item.purchased = false;
      item.purchaserName = null;
      item.amountContributed = 0;
      item.updatedAt = nowIso;
      recalculateRegistryItemTotals(draft, item.id);
      pushAuditVersion(draft, 'RegistryItem', item.id, item);
      return toRegistryItemDto(draft, item);
    });

    if (!unclaimed) {
      return errorJson(404, 'Registry item not found');
    }
    return wrapMiddlewareJson({ item: unclaimed });
  }

  if (pathname === '/api/admin/thank-you-notes' && method === 'POST') {
    const body = await readJsonBody(request);
    const donorName = typeof body.name === 'string' ? body.name.trim() : '';
    const rawAmount = Number(body.amount);
    if (!donorName) {
      return errorJson(400, 'Validation Error: Donor name is required');
    }
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
      return errorJson(400, 'Validation Error: Gift amount must be greater than 0');
    }

    const rawStatus =
      typeof body.thankYouStatus === 'string' ? body.thankYouStatus.trim() : 'Unsent';
    const normalizedStatus =
      rawStatus.toLowerCase() === 'sent'
        ? 'Sent'
        : rawStatus.toLowerCase().replace(/_/g, ' ') === 'not needed'
          ? 'Not Needed'
          : 'Unsent';

    const createdItem = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const dateStr =
        typeof body.date === 'string' &&
        body.date.trim() &&
        !Number.isNaN(new Date(body.date).getTime())
          ? new Date(body.date).toISOString()
          : nowIso;
      const registryItemId =
        typeof body.registryItemId === 'string' && body.registryItemId.trim()
          ? body.registryItemId.trim()
          : null;
      const invitationCodeId =
        typeof body.invitationCodeId === 'string' && body.invitationCodeId.trim()
          ? body.invitationCodeId.trim()
          : null;

      const created: DemoContributorRecord = {
        id: generateDemoId('contrib'),
        name: donorName,
        email:
          typeof body.email === 'string' && body.email.trim()
            ? body.email.trim()
            : null,
        isPlusOne: false,
        amount: Math.round(rawAmount * 100) / 100,
        refundedAmount: 0,
        status: 'CONFIRMED',
        coverFee: false,
        feeAmount: 0,
        date: dateStr,
        message:
          typeof body.message === 'string' && body.message.trim()
            ? body.message.trim()
            : null,
        thankYouStatus: normalizedStatus,
        thankYouSentAt: normalizedStatus === 'Sent' ? nowIso : null,
        thankYouNote:
          typeof body.thankYouNote === 'string' && body.thankYouNote.trim()
            ? body.thankYouNote.trim()
            : null,
        stripePaymentIntentId: null,
        stripeChargeId: null,
        transactionTimestamp: dateStr,
        confirmationEmailSentAt: null,
        alertEmailSentAt: null,
        reminderEmailSentAt: null,
        retailerOrderNumber: null,
        carrier: null,
        trackingNumber: null,
        registryItemId,
        invitationCodeId,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.contributor.unshift(created);
      if (registryItemId) {
        recalculateRegistryItemTotals(draft, registryItemId);
      }
      pushAuditVersion(draft, 'Contributor', created.id, created);
      return toContributorDto(draft, created, { includeRelations: true });
    });

    return wrapMiddlewareJson(
      {
        success: true,
        item: createdItem,
      },
      { status: 201 },
    );
  }

  if (pathname === '/api/admin/thank-you-notes' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const statusParam = (searchParams.get('status') || 'all').trim().toLowerCase();
    const search = (searchParams.get('search') || '').trim().toLowerCase();
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.max(
      1,
      parseInt(searchParams.get('pageSize') || '50', 10) || 50,
    );

    let sent = 0;
    let unsent = 0;
    let notNeeded = 0;
    for (const c of snapshot.contributor) {
      const st = (c.thankYouStatus || 'Unsent')
        .trim()
        .toLowerCase()
        .replace(/_/g, ' ');
      if (st === 'sent') sent += 1;
      else if (st === 'not needed' || st === 'notneeded') notNeeded += 1;
      else unsent += 1;
    }
    const totalAll = snapshot.contributor.length;
    const thanked = sent + notNeeded;
    const completionPercentage =
      totalAll > 0 ? Math.round((thanked / totalAll) * 100) : 0;

    const filtered = snapshot.contributor
      .filter((c) => {
        if (statusParam && statusParam !== 'all') {
          const normalized = (c.thankYouStatus || 'Unsent')
            .trim()
            .toLowerCase()
            .replace(/_/g, ' ');
          const target = statusParam.replace(/_/g, ' ');
          if (normalized !== target) return false;
        }
        if (search) {
          const item = c.registryItemId
            ? snapshot.registryItem.find((r) => r.id === c.registryItemId)
            : null;
          const matchesName = c.name.toLowerCase().includes(search);
          const matchesItem = (item?.name ?? '').toLowerCase().includes(search);
          if (!matchesName && !matchesItem) return false;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date));

    const totalItems = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const items = filtered
      .slice((page - 1) * pageSize, page * pageSize)
      .map((c) => toContributorDto(snapshot, c, { includeRelations: true }));

    return wrapMiddlewareJson({
      success: true,
      items,
      metrics: {
        total: totalAll,
        sent,
        unsent,
        notNeeded,
        thanked,
        completionPercentage,
      },
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages,
      },
    });
  }

  if (pathname === '/api/admin/thank-you-notes/export' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const csv = buildThankYouNotesCsv(
      snapshot.contributor,
      snapshot.registryItem,
      snapshot.invitationCode,
    );
    return binaryResponse(csv, 'text/csv; charset=utf-8', {
      'Content-Disposition': 'attachment; filename="thank-you-notes.csv"',
    });
  }

  if (
    pathname === '/api/admin/thank-you-notes/export-labels' &&
    (method === 'GET' || method === 'POST')
  ) {
    const snapshot = store.getSnapshot();
    const lines = snapshot.contributor.map((c) => {
      const inv = c.invitationCodeId
        ? snapshot.invitationCode.find((i) => i.id === c.invitationCodeId)
        : null;
      const addr = inv
        ? [inv.addressLine1, inv.city, inv.state, inv.zipCode]
          .filter(Boolean)
          .join(', ')
        : 'Address pending';
      return `${c.name} — ${addr}`;
    });
    const pdf = buildSimplePdfBytes('Thank-You Mailing Labels', lines);
    return binaryResponse(pdf, 'application/pdf', {
      'Content-Disposition': 'attachment; filename="thank-you-labels.pdf"',
    });
  }

  if (
    pathname === '/api/admin/thank-you-notes/batch' &&
    (method === 'POST' || method === 'PUT' || method === 'PATCH')
  ) {
    const body = await readJsonBody(request);
    const idsRaw = body.ids ?? body.contributorIds ?? [];
    const ids = Array.isArray(idsRaw)
      ? idsRaw.filter((id): id is string => typeof id === 'string')
      : [];
    const nextStatus =
      typeof body.thankYouStatus === 'string'
        ? body.thankYouStatus
        : typeof body.status === 'string'
          ? body.status
          : 'Sent';

    const updatedItems = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const out: Array<Record<string, unknown>> = [];
      for (const id of ids) {
        const c = draft.contributor.find((item) => item.id === id);
        if (!c) continue;
        c.thankYouStatus = nextStatus;
        if (nextStatus === 'Sent') c.thankYouSentAt = nowIso;
        else if (nextStatus === 'Unsent') c.thankYouSentAt = null;
        if (typeof body.thankYouNote === 'string') {
          c.thankYouNote = body.thankYouNote;
        }
        c.updatedAt = nowIso;
        out.push(toContributorDto(draft, c, { includeRelations: true }));
      }
      return out;
    });

    return wrapMiddlewareJson({
      success: true,
      count: updatedItems.length,
      updatedCount: updatedItems.length,
      items: updatedItems,
    });
  }

  const thankYouIdMatch = pathname.match(/^\/api\/admin\/thank-you-notes\/([^/]+)$/);
  if (thankYouIdMatch && (method === 'PUT' || method === 'PATCH')) {
    const id = decodeURIComponent(thankYouIdMatch[1]);
    const body = await readJsonBody(request);
    const updated = store.mutate((draft) => {
      const c = draft.contributor.find((item) => item.id === id);
      if (!c) return null;
      const nowIso = new Date().toISOString();
      if (typeof body.thankYouStatus === 'string') {
        c.thankYouStatus = body.thankYouStatus;
        if (body.thankYouStatus === 'Sent' && body.thankYouSentAt === undefined) {
          c.thankYouSentAt = nowIso;
        } else if (
          body.thankYouStatus === 'Unsent' &&
          body.thankYouSentAt === undefined
        ) {
          c.thankYouSentAt = null;
        }
      }
      if (body.thankYouSentAt !== undefined) {
        c.thankYouSentAt =
          typeof body.thankYouSentAt === 'string' ? body.thankYouSentAt : null;
      }
      if (body.thankYouNote !== undefined) {
        c.thankYouNote =
          typeof body.thankYouNote === 'string' ? body.thankYouNote : null;
      }
      if (body.invitationCodeId !== undefined) {
        c.invitationCodeId =
          typeof body.invitationCodeId === 'string' && body.invitationCodeId.trim()
            ? body.invitationCodeId.trim()
            : null;
      }
      c.updatedAt = nowIso;
      pushAuditVersion(draft, 'Contributor', c.id, c);
      return toContributorDto(draft, c, { includeRelations: true });
    });

    if (!updated) {
      return errorJson(404, 'Contributor thank-you record not found');
    }
    return wrapMiddlewareJson({
      success: true,
      ...updated,
      data: updated,
    });
  }

  const contribActionMatch = pathname.match(
    /^\/api\/admin\/contributors\/([^/]+)\/action$/,
  );
  if (contribActionMatch && method === 'POST') {
    const contributorId = decodeURIComponent(contribActionMatch[1]);
    const body = await readJsonBody(request);
    const action = typeof body.action === 'string' ? body.action : 'confirm';

    const result = store.mutate((draft) => {
      const contributor = draft.contributor.find((c) => c.id === contributorId);
      if (!contributor) return null;
      const nowIso = new Date().toISOString();
      let changed = false;

      if (action === 'confirm') {
        changed = contributor.status !== 'CONFIRMED';
        contributor.status = 'CONFIRMED';
      } else if (action === 'remind') {
        changed = true;
        contributor.reminderEmailSentAt = nowIso;
      } else if (action === 'refund') {
        changed = contributor.status !== 'REFUNDED';
        contributor.status = 'REFUNDED';
        contributor.refundedAmount = contributor.amount;
      } else {
        changed = contributor.status !== 'CANCELLED';
        contributor.status = 'CANCELLED';
      }

      contributor.updatedAt = nowIso;
      const item = contributor.registryItemId
        ? recalculateRegistryItemTotals(draft, contributor.registryItemId)
        : null;
      pushAuditVersion(draft, 'Contributor', contributor.id, contributor);

      return {
        action,
        changed,
        contributor: {
          id: contributor.id,
          status: contributor.status,
          refundedAmount: contributor.refundedAmount,
          reminderEmailSentAt: contributor.reminderEmailSentAt,
        },
        item: item ? toRegistryItemDto(draft, item) : null,
      };
    });

    if (!result) {
      return errorJson(404, 'Contributor not found');
    }
    return wrapMiddlewareJson(result);
  }

  const contributorIdMatch = pathname.match(/^\/api\/admin\/contributors\/([^/]+)$/);
  if (contributorIdMatch) {
    const contributorId = decodeURIComponent(contributorIdMatch[1]).trim();
    if (!contributorId) {
      return errorJson(400, 'Contributor ID is required');
    }

    if (method === 'PATCH') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) => {
        const contributor = draft.contributor.find((c) => c.id === contributorId);
        if (!contributor) return null;
        const nowIso = new Date().toISOString();

        if (typeof body.name === 'string' && body.name.trim()) {
          contributor.name = body.name.trim();
        }
        if (body.email !== undefined) {
          contributor.email =
            typeof body.email === 'string' && body.email.trim()
              ? body.email.trim()
              : null;
        }
        if (typeof body.amount === 'number' && Number.isFinite(body.amount) && body.amount >= 0) {
          contributor.amount = Math.round(body.amount * 100) / 100;
        }
        if (
          body.status === 'RESERVED' ||
          body.status === 'CONFIRMED' ||
          body.status === 'CANCELLED' ||
          body.status === 'REFUNDED'
        ) {
          contributor.status = body.status;
        }
        if (body.message !== undefined) {
          contributor.message =
            typeof body.message === 'string' && body.message.trim()
              ? body.message.trim()
              : null;
        }
        contributor.updatedAt = nowIso;
        const item = contributor.registryItemId
          ? recalculateRegistryItemTotals(draft, contributor.registryItemId)
          : null;
        pushAuditVersion(draft, 'Contributor', contributor.id, contributor);
        return {
          contributor: toContributorDto(draft, contributor),
          item: item ? toRegistryItemDto(draft, item) : null,
        };
      });

      if (!updated) {
        return errorJson(404, 'Contributor not found');
      }
      return wrapMiddlewareJson(updated);
    }

    if (method === 'DELETE') {
      const deleted = store.mutate((draft) => {
        const idx = draft.contributor.findIndex((c) => c.id === contributorId);
        if (idx < 0) return null;
        const [removed] = draft.contributor.splice(idx, 1);
        const item = removed.registryItemId
          ? recalculateRegistryItemTotals(draft, removed.registryItemId)
          : null;
        pushAuditVersion(draft, 'Contributor', contributorId, {
          deleted: true,
          previous: removed,
        });
        return {
          deletedId: contributorId,
          item: item ? toRegistryItemDto(draft, item) : null,
        };
      });

      if (!deleted) {
        return errorJson(404, 'Contributor not found');
      }
      return wrapMiddlewareJson(deleted);
    }
  }

  // --- Broadcasts & Cron ---
  if (pathname === '/api/admin/broadcast/history' && method === 'GET') {
    let limit = 50;
    if (searchParams.has('limit')) {
      const rawLimit = searchParams.get('limit');
      if (rawLimit === null || rawLimit.trim() === '' || !/^-?\d+$/.test(rawLimit.trim())) {
        return errorJson(400, 'Invalid limit parameter');
      }
      const parsedLimit = parseInt(rawLimit.trim(), 10);
      if (parsedLimit <= 0) {
        return errorJson(400, 'Invalid limit parameter');
      }
      limit = Math.min(parsedLimit, 100);
    }

    let page = 1;
    if (searchParams.has('page')) {
      const rawPage = searchParams.get('page');
      if (rawPage === null || rawPage.trim() === '' || !/^-?\d+$/.test(rawPage.trim())) {
        return errorJson(400, 'Invalid page parameter');
      }
      const parsedPage = parseInt(rawPage.trim(), 10);
      if (parsedPage < 1) {
        return errorJson(400, 'Invalid page parameter');
      }
      page = parsedPage;
    }

    const snapshot = store.getSnapshot();
    const sorted = [...snapshot.broadcastMessage]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((msg) => ({
        ...msg,
        recipients: snapshot.broadcastRecipient.filter(
          (r) => r.broadcastId === msg.id,
        ),
      }));
    const total = sorted.length;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    const paged = sorted.slice((page - 1) * limit, page * limit);

    const headers: Record<string, string> = {
      'X-Total-Count': String(total),
      'X-Page': String(page),
      'X-Limit': String(limit),
      'X-Total-Pages': String(totalPages),
      'X-Per-Page': String(limit),
      'X-Current-Page': String(page),
      'X-Has-Next-Page': String(page < totalPages),
      'X-Has-Prev-Page': String(page > 1),
      'Access-Control-Expose-Headers':
        'X-Total-Count, X-Page, X-Limit, X-Total-Pages, X-Per-Page, X-Current-Page, X-Has-Next-Page, X-Has-Prev-Page, X-Next-Cursor',
    };
    const lastEntry = paged[paged.length - 1];
    if (lastEntry && (paged.length === limit || page < totalPages)) {
      headers['X-Next-Cursor'] = lastEntry.id;
    }

    return wrapMiddlewareJson(paged, { headers });
  }

  if (pathname === '/api/admin/broadcast/preview' && method === 'POST') {
    const body = await readJsonBody(request);
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    const sampleGuest = snapshot.invitationCode[0] ?? {
      guestName: 'Jordan & Casey',
      code: 'DEMO2026',
      householdName: 'Jordan Household',
    };
    const rawSubject =
      typeof body.subject === 'string'
        ? body.subject
        : `Update from ${config.partner1Name} & ${config.partner2Name}`;
    const rawBody = typeof body.body === 'string' ? body.body : '';
    const renderedSubject = interpolateBroadcastTemplate(
      rawSubject,
      sampleGuest,
      config.partner1Name,
      config.partner2Name,
      config.baseUrl,
    );
    const renderedBody = interpolateBroadcastTemplate(
      rawBody,
      sampleGuest,
      config.partner1Name,
      config.partner2Name,
      config.baseUrl,
    );

    return wrapMiddlewareJson({
      subject: renderedSubject,
      body: renderedBody,
      html: `<div style="font-family:sans-serif;line-height:1.5">${renderedBody.replace(/\n/g, '<br/>')}</div>`,
      recipientCount: snapshot.invitationCode.length,
      matchedGuests: snapshot.invitationCode.map((g) => ({
        id: g.id,
        guestName: g.guestName,
        email: g.email,
        code: g.code,
      })),
    });
  }

  if (pathname === '/api/admin/broadcast/send' && method === 'POST') {
    const body = await readJsonBody(request);
    const channel: 'EMAIL' | 'SMS' = body.channel === 'SMS' ? 'SMS' : 'EMAIL';
    const subject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : null;
    const msgBody =
      typeof body.body === 'string' && body.body.trim()
        ? body.body.trim()
        : 'Wedding broadcast message';
    const scheduledFor =
      typeof body.scheduledFor === 'string' && body.scheduledFor.trim()
        ? body.scheduledFor.trim()
        : null;

    const created = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const isFuture =
        Boolean(scheduledFor) &&
        Date.parse(scheduledFor!) > Date.now() + 30_000;
      const broadcastId = generateDemoId('broadcast');
      const guests = draft.invitationCode;
      const msg: DemoBroadcastMessageRecord = {
        id: broadcastId,
        channel,
        subject,
        body: msgBody,
        targetFilters:
          body.targetFilters && typeof body.targetFilters === 'object'
            ? (body.targetFilters as Record<string, unknown>)
            : {},
        status: isFuture ? 'SCHEDULED' : 'SENT',
        totalRecipients: guests.length,
        sentCount: isFuture ? 0 : guests.length,
        failedCount: 0,
        scheduledFor: isFuture ? scheduledFor : null,
        sentAt: isFuture ? null : nowIso,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      draft.broadcastMessage.unshift(msg);
      const recipients: DemoBroadcastRecipientRecord[] = guests.map(
        (g, idx) => ({
          id: generateDemoId(`brecip-${idx}`),
          broadcastId,
          invitationCodeId: g.id,
          guestName: g.guestName,
          destination: g.email || `guest${idx + 1}@example.org`,
          status: isFuture ? 'PENDING' : 'SENT',
          error: null,
          sentAt: isFuture ? null : nowIso,
          createdAt: nowIso,
          updatedAt: nowIso,
        }),
      );
      draft.broadcastRecipient.unshift(...recipients);
      return { ...msg, recipients };
    });

    return wrapMiddlewareJson(created, { status: 201 });
  }

  if (pathname === '/api/admin/broadcast/test-send' && method === 'POST') {
    const body = await readJsonBody(request);
    const snapshot = store.getSnapshot();
    const config = getActiveAppConfig(snapshot);
    return wrapMiddlewareJson({
      success: true,
      channel: body.channel === 'SMS' ? 'SMS' : 'EMAIL',
      destination:
        typeof body.destination === 'string' && body.destination.trim()
          ? body.destination.trim()
          : config.contactEmail,
      subject:
        typeof body.subject === 'string' ? body.subject : 'Test Broadcast',
      body: typeof body.body === 'string' ? body.body : '',
    });
  }

  if (pathname === '/api/admin/broadcast/test-connection' && method === 'POST') {
    return wrapMiddlewareJson({
      success: true,
      ok: true,
      provider: 'static-demo',
      message: 'Demo messaging connection verified locally.',
    });
  }

  if (pathname === '/api/admin/broadcast/retry' && method === 'POST') {
    const body = await readJsonBody(request);
    const broadcastId =
      typeof body.broadcastId === 'string' ? body.broadcastId : '';
    const retried = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      const msg = draft.broadcastMessage.find((m) => m.id === broadcastId);
      let count = 0;
      for (const r of draft.broadcastRecipient) {
        if (r.broadcastId === broadcastId && r.status !== 'SENT') {
          r.status = 'SENT';
          r.sentAt = nowIso;
          r.error = null;
          count += 1;
        }
      }
      if (msg) {
        msg.status = 'SENT';
        msg.failedCount = 0;
        msg.sentCount = msg.totalRecipients;
        msg.sentAt = nowIso;
        msg.updatedAt = nowIso;
      }
      return count;
    });
    return wrapMiddlewareJson({
      success: true,
      retriedCount: retried,
      sentCount: retried,
    });
  }

  const broadcastSchedMatch = pathname.match(
    /^\/api\/admin\/broadcast\/schedule\/([^/]+)$/,
  );
  if (broadcastSchedMatch) {
    const id = decodeURIComponent(broadcastSchedMatch[1]);
    if (method === 'DELETE') {
      store.mutate((draft) => {
        const msg = draft.broadcastMessage.find((m) => m.id === id);
        if (msg) {
          msg.status = 'CANCELLED';
          msg.updatedAt = new Date().toISOString();
        }
      });
      return wrapMiddlewareJson({ id, status: 'CANCELLED', cancelled: true });
    }
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readJsonBody(request);
      const updated = store.mutate((draft) => {
        const msg = draft.broadcastMessage.find((m) => m.id === id);
        if (!msg) return null;
        if (typeof body.scheduledFor === 'string') {
          msg.scheduledFor = body.scheduledFor;
        }
        msg.updatedAt = new Date().toISOString();
        return { ...msg };
      });
      return updated
        ? wrapMiddlewareJson(updated)
        : errorJson(404, 'Scheduled broadcast not found');
    }
  }

  const broadcastDetailMatch = pathname.match(/^\/api\/admin\/broadcast\/([^/]+)$/);
  if (broadcastDetailMatch && method === 'GET') {
    const id = decodeURIComponent(broadcastDetailMatch[1]).trim();
    if (!id) {
      return errorJson(400, 'Broadcast ID is required.');
    }
    const snapshot = store.getSnapshot();
    const msg = snapshot.broadcastMessage.find((m) => m.id === id);
    if (!msg) {
      return errorJson(404, 'Broadcast message not found.');
    }
    return wrapMiddlewareJson({
      ...msg,
      recipients: snapshot.broadcastRecipient.filter((r) => r.broadcastId === msg.id),
    });
  }

  if (pathname === '/api/cron/broadcasts' && (method === 'GET' || method === 'POST')) {
    const processed = store.mutate((draft) => {
      const nowIso = new Date().toISOString();
      let count = 0;
      for (const msg of draft.broadcastMessage) {
        if (msg.status === 'SCHEDULED') {
          msg.status = 'SENT';
          msg.sentCount = msg.totalRecipients;
          msg.sentAt = nowIso;
          msg.updatedAt = nowIso;
          count += 1;
        }
      }
      return count;
    });
    return wrapMiddlewareJson({ processed });
  }

  // --- Version History & Audit Restore ---
  if (pathname === '/api/admin/versions' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const entityType = searchParams.get('entityType')?.trim() || '';
    const entityId = searchParams.get('entityId')?.trim() || '';
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get('limit') || '50', 10) || 50),
    );

    const filtered = snapshot.snapshotVersion.filter((v) => {
      if (entityType && v.entityType !== entityType) return false;
      if (entityId && v.entityId !== entityId) return false;
      return true;
    });

    const total = filtered.length;
    const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
    const items = filtered
      .slice((page - 1) * limit, page * limit)
      .map((v) => ({
        ...v,
        data: sanitizeVersionData(v.data),
      }));

    return wrapMiddlewareJson({
      items,
      pagination: {
        total,
        totalCount: total,
        page,
        currentPage: page,
        limit,
        pageSize: limit,
        totalPages,
        isPaginated: true,
      },
    });
  }

  const versionRestoreMatch = pathname.match(
    /^\/api\/admin\/versions\/([^/]+)\/restore$/,
  );
  if (versionRestoreMatch && method === 'POST') {
    const versionId = decodeURIComponent(versionRestoreMatch[1]);
    const restored = store.mutate((draft) => {
      const version = draft.snapshotVersion.find((v) => v.id === versionId);
      if (!version) return null;
      const rawData = version.data;
      const payload =
        rawData.deleted &&
        rawData.previous &&
        typeof rawData.previous === 'object'
          ? (rawData.previous as Record<string, unknown>)
          : rawData;
      const nowIso = new Date().toISOString();

      const upsertById = <T extends { id: string }>(arr: T[], item: T) => {
        const idx = arr.findIndex((x) => x.id === item.id);
        if (idx >= 0) arr[idx] = item;
        else arr.push(item);
      };

      switch (version.entityType) {
        case 'AppConfig': {
          const cfg = getActiveAppConfig(draft);
          if (Array.isArray(payload.current) && !('partner1Name' in payload)) {
            cfg.features = payload.current as typeof cfg.features;
          } else {
            Object.assign(cfg, payload, { id: cfg.id, updatedAt: nowIso });
          }
          break;
        }
        case 'ContentNode':
          upsertById(draft.contentNode, {
            ...(payload as unknown as StaticDemoSnapshot['contentNode'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        case 'RegistryItem':
          upsertById(draft.registryItem, {
            ...(payload as unknown as StaticDemoSnapshot['registryItem'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        case 'Contributor': {
          const contrib = {
            ...(payload as unknown as StaticDemoSnapshot['contributor'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          };
          upsertById(draft.contributor, contrib);
          if (contrib.registryItemId) {
            recalculateRegistryItemTotals(draft, contrib.registryItemId);
          }
          break;
        }
        case 'InvitationCode': {
          const rawInv = payload as unknown as StaticDemoSnapshot['invitationCode'][number];
          const validTableId =
            rawInv.tableId &&
            draft.seatingTable.some(
              (t) => t.id === rawInv.tableId && !isDemoLandmarkShape(t.shape),
            )
              ? rawInv.tableId
              : null;
          upsertById(draft.invitationCode, {
            ...rawInv,
            tableId: validTableId,
            seatNumber: validTableId ? (rawInv.seatNumber ?? null) : null,
            plusOneSeatNumbers:
              validTableId && Array.isArray(rawInv.plusOneSeatNumbers)
                ? rawInv.plusOneSeatNumbers.filter(
                  (n): n is number => typeof n === 'number' && Number.isInteger(n),
                )
                : [],
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        }
        case 'SeatingTable':
          upsertById(draft.seatingTable, {
            ...(payload as unknown as StaticDemoSnapshot['seatingTable'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        case 'WeddingPartyMember':
          upsertById(draft.weddingPartyMember, {
            ...(payload as unknown as StaticDemoSnapshot['weddingPartyMember'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        case 'Attraction':
          upsertById(draft.attraction, {
            ...(payload as unknown as StaticDemoSnapshot['attraction'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        case 'SubEvent':
          upsertById(draft.subEvent, {
            ...(payload as unknown as StaticDemoSnapshot['subEvent'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        case 'Media':
          upsertById(draft.media, {
            ...(payload as unknown as StaticDemoSnapshot['media'][number]),
            id: version.entityId,
            updatedAt: nowIso,
          });
          break;
        default:
          break;
      }

      pushAuditVersion(
        draft,
        version.entityType,
        version.entityId,
        payload,
        'Version Restore',
      );
      return {
        restored: true,
        versionId: version.id,
        entityType: version.entityType,
        entityId: version.entityId,
      };
    });

    if (!restored) {
      return errorJson(404, 'Version snapshot not found');
    }
    return wrapMiddlewareJson(restored);
  }

  // --- Backup Maintenance Export & Import ---
  if (pathname === '/api/admin/maintenance/export' && method === 'GET') {
    const snapshot = store.getSnapshot();
    const backup = buildBackupExportPayload(snapshot);
    const jsonText = JSON.stringify(backup, null, 2);
    const dateStamp = new Date().toISOString().slice(0, 10);
    return binaryResponse(jsonText, 'application/json; charset=utf-8', {
      'Content-Disposition': `attachment; filename="wedding-backup-${dateStamp}.json"`,
    });
  }

  if (pathname === '/api/admin/maintenance/import' && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    let parsedBackup: Record<string, unknown> | null = null;

    if (contentType.includes('multipart/form-data')) {
      try {
        const formData = await request.formData();
        const file = formData.get('file') ?? formData.get('backup');
        if (file && typeof file === 'object' && 'text' in file) {
          const text = await (file as Blob).text();
          const raw: unknown = JSON.parse(text);
          if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            parsedBackup = raw as Record<string, unknown>;
          }
        }
      } catch {
        return errorJson(400, 'Invalid backup JSON file.');
      }
    } else {
      const body = await readJsonBody(request);
      parsedBackup =
        body.data && typeof body.data === 'object' && !Array.isArray(body.data)
          ? (body.data as Record<string, unknown>)
          : body;
    }

    if (
      !parsedBackup ||
      !Array.isArray(parsedBackup.appConfig) ||
      parsedBackup.appConfig.length === 0
    ) {
      return errorJson(
        400,
        'Invalid v2.0 backup payload: missing required appConfig array.',
      );
    }

    const current = store.getSnapshot();
    const nowIso = new Date().toISOString();
    const nextSnapshot: StaticDemoSnapshot = {
      storeVersion: STATIC_DEMO_STORE_VERSION,
      schemaVersion: STATIC_DEMO_BACKUP_SCHEMA_VERSION,
      activeArchetype: current.activeArchetype,
      isSetupMode: false,
      isAdminAuthenticated: true,
      guestSession: current.guestSession,
      storageWarning: null,
      updatedAt: nowIso,
      appConfig: parsedBackup.appConfig as StaticDemoSnapshot['appConfig'],
      contentNode: Array.isArray(parsedBackup.contentNode)
        ? (parsedBackup.contentNode as StaticDemoSnapshot['contentNode'])
        : current.contentNode,
      media: Array.isArray(parsedBackup.media)
        ? (parsedBackup.media as StaticDemoSnapshot['media'])
        : current.media,
      seatingTable: Array.isArray(parsedBackup.seatingTable)
        ? (parsedBackup.seatingTable as StaticDemoSnapshot['seatingTable'])
        : current.seatingTable,
      invitationCode: Array.isArray(parsedBackup.invitationCode)
        ? (() => {
          const nextTables = Array.isArray(parsedBackup.seatingTable)
            ? (parsedBackup.seatingTable as StaticDemoSnapshot['seatingTable'])
            : current.seatingTable;
          const validTableIds = new Set(
            nextTables
              .filter((t) => !isDemoLandmarkShape(t.shape))
              .map((t) => t.id),
          );
          return (
            parsedBackup.invitationCode as StaticDemoSnapshot['invitationCode']
          ).map((inv) => {
            const hasValidTable = Boolean(inv.tableId && validTableIds.has(inv.tableId));
            return {
              ...inv,
              tableId: hasValidTable ? inv.tableId : null,
              seatNumber: hasValidTable ? (inv.seatNumber ?? null) : null,
              plusOneSeatNumbers:
                hasValidTable && Array.isArray(inv.plusOneSeatNumbers)
                  ? inv.plusOneSeatNumbers.filter(
                    (n): n is number => typeof n === 'number' && Number.isInteger(n),
                  )
                  : [],
            };
          });
        })()
        : current.invitationCode,
      weddingPartyMember: Array.isArray(parsedBackup.weddingPartyMember)
        ? (parsedBackup.weddingPartyMember as StaticDemoSnapshot['weddingPartyMember'])
        : current.weddingPartyMember,
      attraction: Array.isArray(parsedBackup.attraction)
        ? (parsedBackup.attraction as StaticDemoSnapshot['attraction'])
        : current.attraction,
      registryItem: Array.isArray(parsedBackup.registryItem)
        ? (parsedBackup.registryItem as StaticDemoSnapshot['registryItem'])
        : current.registryItem,
      contributor: Array.isArray(parsedBackup.contributor)
        ? (parsedBackup.contributor as StaticDemoSnapshot['contributor'])
        : current.contributor,
      subEvent: Array.isArray(parsedBackup.subEvent)
        ? (parsedBackup.subEvent as StaticDemoSnapshot['subEvent'])
        : current.subEvent,
      subEventAccess: Array.isArray(parsedBackup.subEventAccess)
        ? (parsedBackup.subEventAccess as StaticDemoSnapshot['subEventAccess'])
        : current.subEventAccess,
      subEventRsvp: Array.isArray(parsedBackup.subEventRsvp)
        ? (parsedBackup.subEventRsvp as StaticDemoSnapshot['subEventRsvp'])
        : current.subEventRsvp,
      broadcastMessage: Array.isArray(parsedBackup.broadcastMessage)
        ? (parsedBackup.broadcastMessage as StaticDemoSnapshot['broadcastMessage'])
        : current.broadcastMessage,
      broadcastRecipient: Array.isArray(parsedBackup.broadcastRecipient)
        ? (parsedBackup.broadcastRecipient as StaticDemoSnapshot['broadcastRecipient'])
        : current.broadcastRecipient,
      snapshotVersion: Array.isArray(parsedBackup.snapshotVersion)
        ? (parsedBackup.snapshotVersion as StaticDemoSnapshot['snapshotVersion'])
        : current.snapshotVersion,
    };

    store.replaceSnapshot(nextSnapshot);

    return wrapMiddlewareJson({
      success: true,
      message: 'Database backup imported successfully.',
      restoredCounts: {
        appConfig: nextSnapshot.appConfig.length,
        registryItem: nextSnapshot.registryItem.length,
        invitationCode: nextSnapshot.invitationCode.length,
        seatingTable: nextSnapshot.seatingTable.length,
        subEvent: nextSnapshot.subEvent.length,
        contentNode: nextSnapshot.contentNode.length,
      },
    });
  }

  return null;
}
