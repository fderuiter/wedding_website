import { ARCHETYPE_PRESETS, type ArchetypeId } from '@/lib/sampleData/archetypes';
import { THEME_PRESET_KEYS, type ThemePreset } from '@/lib/theme/presets';
import type { PublicAppConfig } from '@/lib/config';
import type {
  HouseholdMemberDTO,
  HouseholdMemberRole,
  InvitationCodeDTO,
} from '@/features/registry';
import type {
  AccessMatrixGuestEventRsvp,
  RsvpDietaryBreakdown,
  RsvpSummaryResponse,
  SubEventRsvpSummaryItem,
} from '@/features/sub-events';
import { isFeatureEnabled, resolveModuleConfig, type ModuleConfig } from '@/lib/modules';
import {
  cleanOptionalSetupText,
  hasCustomStoryText,
  hasNonPlaceholderVenueDetails,
} from '@/lib/setupCopy';
import { normalizePartyTags, splitMemberFullName } from '@/utils/invitationValidation';
import { normalizeVenueWeddingDate } from '@/utils/venueDateTime';
import {
  buildDemoHouseholdMembersForGuest,
  type DemoBroadcastRecipientRecord,
  type DemoBroadcastRecord,
  type DemoFeatureItem,
  type DemoSubEventMemberRsvpRecord,
  type DemoSubEventRsvpRecord,
} from '../demoSeed';
import {
  applyDemoSampleSelection,
  buildDemoDatabaseBackup,
  getActiveArchetypeDataset,
  getDemoState,
  getEffectiveDemoSettings,
  importDemoDatabaseBackup,
  isDemoAdminSession,
  mutateActiveDataset,
  purgeDemoSampleData,
  recordDemoAuditVersion,
  restoreDemoAuditVersion,
  setDemoPersona,
  setDemoSetupAuthenticated,
  updateDemoConfigOverrides,
} from '../demoStore';
import {
  type DemoRouteContext,
  binaryResponse,
  buildDemoCsv,
  buildPaginationHeaders,
  createMinimalPdfBytes,
  jsonResponse,
  nextDemoId,
  parseFormData,
  parseJsonBody,
  parseRawJsonValue,
  upsertInvitationsIntoStaticDemoStore,
} from './http';
import { isDemoLandmarkShape } from './entityEngine';

function isDemoAddressCollectionOnly(partyTags: unknown): boolean {
  return normalizePartyTags(partyTags).includes('address-collection');
}

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

function toBroadcastHistoryDto(msg: DemoBroadcastRecord) {
  return {
    id: msg.id,
    channel: msg.channel,
    subject: msg.subject,
    body: msg.body,
    audienceLabel: msg.audienceLabel,
    status: msg.status,
    totalRecipients: msg.recipientCount,
    recipientCount: msg.recipientCount,
    sentCount: msg.sentCount,
    failedCount: msg.failedCount,
    viewedCount: msg.viewedCount,
    scheduledFor: msg.scheduledAt,
    scheduledAt: msg.scheduledAt,
    sentAt: msg.sentAt,
    createdBy: msg.createdBy,
    createdAt: msg.createdAt,
    updatedAt: msg.updatedAt,
    recipients: msg.recipients.map((r) => ({
      id: r.id,
      broadcastId: r.broadcastId,
      invitationCodeId: r.invitationCodeId,
      guestName: r.recipientName,
      recipientName: r.recipientName,
      destination: r.recipientEmail,
      recipientEmail: r.recipientEmail,
      channel: r.channel,
      status: r.status,
      error: r.errorMessage,
      sentAt: r.sentAt,
      viewedAt: r.viewedAt,
      createdAt: msg.createdAt,
      updatedAt: msg.updatedAt,
    })),
  };
}

function interpolateBroadcastTemplate(
  template: string,
  guest: { guestName: string; code: string; householdName?: string | null },
  partner1Name: string,
  partner2Name: string,
  baseUrl: string
): string {
  return template
    .replace(/\{\{\s*guestName\s*\}\}/g, guest.guestName)
    .replace(/\{\{\s*code\s*\}\}/g, guest.code)
    .replace(/\{\{\s*householdName\s*\}\}/g, guest.householdName || guest.guestName)
    .replace(/\{\{\s*partner1Name\s*\}\}/g, partner1Name)
    .replace(/\{\{\s*partner2Name\s*\}\}/g, partner2Name)
    .replace(/\{\{\s*baseUrl\s*\}\}/g, baseUrl);
}

function createEmptyDietary(): RsvpDietaryBreakdown {
  return {
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
}

export async function handleAdminWorkflowRoutes(
  ctx: DemoRouteContext
): Promise<Response | null> {
  const { url, path, method, init, rawInput } = ctx;

  // 1. Admin Auth & Setup Wizard
  if (path === '/api/admin/me' && method === 'GET') {
    return jsonResponse({ isAdmin: isDemoAdminSession() });
  }

  if (path === '/api/admin/login' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const password = typeof body.password === 'string' ? body.password.trim() : 'demo';
    if ('password' in body && !password) {
      return jsonResponse({ success: false, error: 'Password is required.' }, 400);
    }
    setDemoPersona('admin');
    return jsonResponse({
      success: true,
      authenticated: true,
      requiresSetup: false,
      data: { success: true, authenticated: true, requiresSetup: false },
    });
  }

  if (path === '/api/admin/logout' && method === 'POST') {
    setDemoPersona('guest');
    return jsonResponse({ success: true });
  }

  if (path === '/api/admin/setup') {
    if (method === 'GET') {
      const isSetup = getDemoState().persona === 'setup' && !getDemoState().setupAuthenticated;
      return jsonResponse({
        success: true,
        initialized: true,
        setupCompleted: !isSetup,
        requiresSetup: isSetup,
      });
    }

    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const bodyKeys = Object.keys(body);
      if (bodyKeys.length === 0) {
        const isSetup = getDemoState().persona === 'setup' && !getDemoState().setupAuthenticated;
        return jsonResponse({
          success: true,
          initialized: true,
          setupCompleted: !isSetup,
          requiresSetup: isSetup,
        });
      }
      if ('password' in body && bodyKeys.length === 1) {
        setDemoSetupAuthenticated(true);
        return jsonResponse({ success: true });
      }
      if (
        'setupCompleted' in body &&
        typeof body.setupCompleted === 'boolean' &&
        bodyKeys.length === 1
      ) {
        if (body.setupCompleted) {
          setDemoSetupAuthenticated(true);
          if (getDemoState().persona === 'setup') {
            setDemoPersona('admin');
          }
        }
        return jsonResponse({
          success: true,
          initialized: true,
          setupCompleted: body.setupCompleted,
          requiresSetup: !body.setupCompleted,
        });
      }
      const overrides: Partial<PublicAppConfig> = {};
      const existingSetupTz = getEffectiveDemoSettings().timezone;
      const resolvedSetupTimezone =
        typeof body.timezone === 'string' && body.timezone.trim()
          ? body.timezone.trim()
          : typeof existingSetupTz === 'string' && existingSetupTz.trim()
            ? existingSetupTz.trim()
            : 'America/Chicago';
      if (typeof body.partner1Name === 'string') overrides.partner1Name = body.partner1Name;
      if (typeof body.partner2Name === 'string') overrides.partner2Name = body.partner2Name;
      if (typeof body.weddingDate === 'string' && body.weddingDate) {
        const normalized = normalizeVenueWeddingDate(
          body.weddingDate,
          resolvedSetupTimezone,
          typeof body.ceremonyTime === 'string' ? body.ceremonyTime : undefined
        );
        if (normalized) {
          overrides.weddingDate = normalized;
        }
      }
      if (typeof body.venueName === 'string') {
        overrides.venueName = cleanOptionalSetupText(body.venueName);
      }
      if (typeof body.venueAddress === 'string') {
        overrides.venueAddress = cleanOptionalSetupText(body.venueAddress);
      }
      if (typeof body.venueCity === 'string') {
        overrides.venueCity = cleanOptionalSetupText(body.venueCity);
      }
      if (typeof body.venueState === 'string') {
        overrides.venueState = cleanOptionalSetupText(body.venueState);
      }
      if (typeof body.venueZip === 'string') {
        overrides.venueZip = cleanOptionalSetupText(body.venueZip);
      }
      if (typeof body.latitude === 'number' && Number.isFinite(body.latitude)) {
        overrides.latitude = body.latitude;
      }
      if (typeof body.longitude === 'number' && Number.isFinite(body.longitude)) {
        overrides.longitude = body.longitude;
      }
      if (typeof body.timezone === 'string') overrides.timezone = body.timezone;
      if (typeof body.contactEmail === 'string') overrides.contactEmail = body.contactEmail;
      if (typeof body.heroTitle === 'string') overrides.heroTitle = body.heroTitle;
      if (typeof body.heroSubtitle === 'string') overrides.heroSubtitle = body.heroSubtitle;
      if (typeof body.storyText === 'string') {
        overrides.storyText = cleanOptionalSetupText(body.storyText);
      }
      if (typeof body.venueDescription === 'string') {
        overrides.venueDescription = cleanOptionalSetupText(body.venueDescription);
      }
      if (typeof body.travelAdvice === 'string') {
        overrides.travelAdvice = cleanOptionalSetupText(body.travelAdvice);
      }
      if (typeof body.seoTitle === 'string') overrides.seoTitle = body.seoTitle;
      if (typeof body.seoDescription === 'string') overrides.seoDescription = body.seoDescription;
      if (
        typeof body.themePreset === 'string' &&
        THEME_PRESET_KEYS.includes(body.themePreset as ThemePreset)
      ) {
        overrides.themePreset = body.themePreset as ThemePreset;
      }
      if (typeof body.colorPrimary === 'string') overrides.colorPrimary = body.colorPrimary;
      if (typeof body.colorSecondary === 'string') overrides.colorSecondary = body.colorSecondary;
      if (typeof body.showCountdown === 'boolean') overrides.showCountdown = body.showCountdown;
      if (typeof body.showAddToCalendar === 'boolean') {
        overrides.showAddToCalendar = body.showAddToCalendar;
      }
      if (body.modules && typeof body.modules === 'object' && !Array.isArray(body.modules)) {
        const currentModules = getDemoState().configOverrides.modules;
        const resolvedModules = resolveModuleConfig({
          ...(currentModules ?? {}),
          ...(body.modules as Record<string, unknown>),
        });
        overrides.modules = resolvedModules;
        if (overrides.showCountdown === undefined) {
          overrides.showCountdown = resolvedModules.countdown;
        }
        if (overrides.showAddToCalendar === undefined) {
          overrides.showAddToCalendar = resolvedModules.addToCalendar;
        }
      }
      updateDemoConfigOverrides(overrides);
      setDemoSetupAuthenticated(true);
      recordDemoAuditVersion('AppConfig', 'global', 'SETUP', 'Updated setup wizard configuration', {
        ...overrides,
      });
      return jsonResponse({
        success: true,
        ...(overrides.modules ? { modules: overrides.modules } : {}),
      });
    }
  }

  if (path === '/api/admin/geocode' && method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return jsonResponse({ success: false, error: 'Search query is required.' }, 400);
    }
    const archetype = getDemoState().archetype;
    const region =
      archetype === 'destination'
        ? {
          streetAddress: '450 Ocean Drive',
          city: 'Miami Beach',
          state: 'FL',
          zip: '33139',
          latitude: 25.7743,
          longitude: -80.1304,
        }
        : archetype === 'romantic'
          ? {
            streetAddress: '1120 Silverado Trail',
            city: 'Napa',
            state: 'CA',
            zip: '94558',
            latitude: 38.2975,
            longitude: -122.2869,
          }
          : {
            streetAddress: '123 Oak Ave',
            city: 'Chicago',
            state: 'IL',
            zip: '60601',
            latitude: 41.8842,
            longitude: -87.6324,
          };
    return jsonResponse({
      success: true,
      data: [
        {
          displayName: `${q}, ${region.streetAddress}, ${region.city}, ${region.state} ${region.zip}, United States`,
          name: q,
          streetAddress: region.streetAddress,
          city: region.city,
          state: region.state,
          zip: region.zip,
          country: 'United States',
          latitude: region.latitude,
          longitude: region.longitude,
        },
      ],
    });
  }

  // 2. Sample Data Status, Seed, and Purge
  if (path === '/api/admin/sample-data') {
    if (method === 'GET') {
      const dataset = getActiveArchetypeDataset();
      const counts = {
        registry: dataset.registryItems.filter((i) => i.isSample).length,
        guests: dataset.guests.filter((g) => g.isSample).length,
        seating: dataset.seatingTables.filter((t) => t.isSample).length,
        weddingParty: dataset.weddingParty.filter((m) => m.isSample).length,
        attractions: dataset.attractions.filter((a) => a.isSample).length,
        faqs: dataset.faqs.length,
      };
      const total =
        counts.registry +
        counts.guests +
        counts.seating +
        counts.weddingParty +
        counts.attractions +
        counts.faqs;
      return jsonResponse({
        success: true,
        hasSampleData: total > 0,
        counts,
      });
    }
    if (method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const rawArch = typeof body.archetype === 'string' ? body.archetype : 'classic';
      const archetype: ArchetypeId =
        rawArch in ARCHETYPE_PRESETS ? (rawArch as ArchetypeId) : 'classic';
      const modules = Array.isArray(body.modules)
        ? body.modules.filter((m): m is string => typeof m === 'string')
        : ['registry', 'guests', 'seating', 'weddingParty', 'attractions', 'faqs'];
      applyDemoSampleSelection(archetype, modules);
      return jsonResponse({ success: true });
    }
    if (method === 'DELETE') {
      purgeDemoSampleData();
      return jsonResponse({ success: true });
    }
  }

  // 3. Onboarding Milestones
  if (path === '/api/admin/onboarding-milestones' && method === 'GET') {
    const state = getDemoState();
    const dataset = getActiveArchetypeDataset();
    const effectiveConfig = state.configOverrides;
    const partner1 = (effectiveConfig.partner1Name || effectiveConfig.brideName || '').trim();
    const partner2 = (effectiveConfig.partner2Name || effectiveConfig.groomName || '').trim();
    const weddingDetailsCompleted =
      Boolean(partner1 && partner2) && hasNonPlaceholderVenueDetails(effectiveConfig);
    const customStoryConfigured = hasCustomStoryText(effectiveConfig);
    const hasPublicScheduleEvent =
      dataset.subEvents.some(
        (s) => !s.isPrivate && !(s as { isSample?: boolean }).isSample
      ) ||
      dataset.logisticsNodes.some((node) => {
        const data =
          node?.data && typeof node.data === 'object' && !Array.isArray(node.data)
            ? (node.data as Record<string, unknown>)
            : {};
        if (data.isSample === true || data.isSample === 'true') return false;
        if (data.isPrivate === true || data.isPrivate === 'true') return false;
        return (
          node.type === 'Schedule' ||
          (typeof data.startTime === 'string' && data.startTime.trim().length > 0) ||
          (node.type === 'Logistics' &&
            typeof data.ceremonyTitle === 'string' &&
            data.ceremonyTitle.trim().length > 0)
        );
      });
    const storyAndScheduleCompleted = customStoryConfigured && hasPublicScheduleEvent;
    const guestListCompleted = dataset.guests.some(
      (g) => !g.isSample && !isDemoAddressCollectionOnly(g.partyTags)
    );
    const registryCompleted = dataset.registryItems.some((i) => !i.isSample);
    const seatingCompleted = dataset.seatingTables.some((t) => !t.isSample);
    const faqCompleted = dataset.faqs.some((n) => n.type === 'FAQ' && !n.data.isSample);
    const milestones = [
      {
        id: 'wedding-details',
        title: 'Wedding Details',
        description:
          'Verify partner names, wedding date, venue details, and your public website URL.',
        completed: weddingDetailsCompleted,
        href: '/admin/dashboard/settings',
        actionLabel: weddingDetailsCompleted ? 'Edit Wedding Details' : 'Configure Wedding Details',
      },
      {
        id: 'story-and-schedule',
        title: 'Story & Schedule',
        description:
          'Share your custom couple story and publish at least one public schedule event.',
        completed: storyAndScheduleCompleted,
        href: !customStoryConfigured ? '/admin/dashboard/settings' : '/admin/dashboard/sub-events',
        actionLabel: storyAndScheduleCompleted
          ? 'Edit Story & Schedule'
          : !customStoryConfigured
            ? 'Write Our Story'
            : 'Add Schedule Event',
      },
      {
        id: 'guest-list',
        title: 'Guest List',
        description: 'Import or add guest invitations so guests can RSVP.',
        completed: guestListCompleted,
        href: '/admin/dashboard/invitation-codes',
        actionLabel: guestListCompleted ? 'Manage Guest List' : 'Add Guest List',
      },
      ...(isFeatureEnabled('registry', effectiveConfig.modules)
        ? [
          {
            id: 'registry',
            title: 'Gift Registry',
            description: 'Add gifts or cash funds to your wedding registry.',
            completed: registryCompleted,
            href: '/registry/add-item',
            actionLabel: registryCompleted ? 'Add More Gifts' : 'Add Registry Gifts',
          },
        ]
        : []),
      {
        id: 'seating-layout',
        title: 'Seating Layout',
        description: 'Create reception tables and organize your seating chart.',
        completed: seatingCompleted,
        href: '/admin/dashboard/seating-chart',
        actionLabel: seatingCompleted ? 'Edit Seating Layout' : 'Create Seating Layout',
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
    const completedCount = milestones.filter((m) => m.completed).length;
    return jsonResponse({
      success: true,
      data: {
        completedCount,
        pendingCount: milestones.length - completedCount,
        totalCount: milestones.length,
        allComplete: completedCount === milestones.length,
        milestones,
      },
    });
  }

  // 4. Site Manager Features (GET returns typed Feature[] directly inside data!)
  if (path === '/api/admin/features') {
    if (method === 'GET') {
      const state = getDemoState();
      const dataset = getActiveArchetypeDataset();
      const features: DemoFeatureItem[] = Array.isArray(state.configOverrides.features)
        ? state.configOverrides.features
        : dataset.features;
      return jsonResponse({
        success: true,
        data: features,
      });
    }

    if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
      const rawPayload = await parseRawJsonValue(init, rawInput);
      const bodyObj =
        rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
          ? (rawPayload as Record<string, unknown>)
          : {};
      const incomingFeatures: DemoFeatureItem[] | null = Array.isArray(rawPayload)
        ? (rawPayload as DemoFeatureItem[])
        : Array.isArray(bodyObj.features)
          ? (bodyObj.features as DemoFeatureItem[])
          : null;

      if (!incomingFeatures) {
        return jsonResponse({ success: false, error: 'Expected features array.' }, 400);
      }

      const nextFeatures: DemoFeatureItem[] = incomingFeatures.map((f, idx) => ({
        id: String(f.id || `feature-${idx + 1}`),
        type: f.type || 'custom',
        title: String(f.title || 'Section'),
        visible: f.visible !== false,
        ...(typeof f.content === 'string' ? { content: f.content } : {}),
      }));

      mutateActiveDataset((current) => ({
        ...current,
        features: nextFeatures,
        ...(bodyObj.modules && typeof bodyObj.modules === 'object'
          ? { modules: resolveModuleConfig(bodyObj.modules as Partial<ModuleConfig>) }
          : {}),
      }));
      updateDemoConfigOverrides({
        features: nextFeatures,
        ...(bodyObj.modules && typeof bodyObj.modules === 'object'
          ? { modules: resolveModuleConfig(bodyObj.modules as Partial<ModuleConfig>) }
          : {}),
      });
      recordDemoAuditVersion(
        'AppConfig',
        'global',
        'UPDATE_FEATURES',
        'Updated homepage section layout & visibility in Site Manager',
        { features: nextFeatures }
      );

      return jsonResponse({
        success: true,
        data: nextFeatures,
        features: nextFeatures,
      });
    }
  }

  // 5. Admin Settings & Profiles
  if (path === '/api/admin/settings') {
    if (method === 'GET') {
      const settings = getEffectiveDemoSettings();
      if (url.searchParams.get('list') === 'true') {
        return jsonResponse({ success: true, data: [settings] });
      }
      return jsonResponse({ success: true, data: settings });
    }

    if (method === 'PUT' || method === 'POST' || method === 'PATCH') {
      const body = await parseJsonBody(init, rawInput);
      const overrides: Partial<PublicAppConfig> = {};

      const existingSettingsTz = getEffectiveDemoSettings().timezone;
      const resolvedSettingsTimezone =
        typeof body.timezone === 'string' && body.timezone.trim()
          ? body.timezone.trim()
          : typeof existingSettingsTz === 'string' && existingSettingsTz.trim()
            ? existingSettingsTz.trim()
            : 'UTC';
      if (typeof body.partner1Name === 'string') overrides.partner1Name = body.partner1Name;
      if (typeof body.partner2Name === 'string') overrides.partner2Name = body.partner2Name;
      if (typeof body.brideName === 'string') overrides.brideName = body.brideName;
      if (typeof body.groomName === 'string') overrides.groomName = body.groomName;
      if (typeof body.weddingDate === 'string' && body.weddingDate) {
        const parsed = normalizeVenueWeddingDate(
          body.weddingDate,
          resolvedSettingsTimezone,
          typeof body.ceremonyTime === 'string' ? body.ceremonyTime : undefined
        );
        if (parsed && !Number.isNaN(parsed.getTime())) {
          overrides.weddingDate = parsed;
        }
      }
      if (typeof body.venueName === 'string') overrides.venueName = body.venueName;
      if (typeof body.venueAddress === 'string') overrides.venueAddress = body.venueAddress;
      if (typeof body.venueCity === 'string') overrides.venueCity = body.venueCity;
      if (typeof body.venueState === 'string') overrides.venueState = body.venueState;
      if (typeof body.venueZip === 'string') overrides.venueZip = body.venueZip;
      if (typeof body.latitude === 'number' && Number.isFinite(body.latitude)) {
        overrides.latitude = body.latitude;
      }
      if (typeof body.longitude === 'number' && Number.isFinite(body.longitude)) {
        overrides.longitude = body.longitude;
      }
      if (typeof body.storyText === 'string') overrides.storyText = body.storyText;
      if (typeof body.venueDescription === 'string') {
        overrides.venueDescription = body.venueDescription;
      }
      if (typeof body.travelAdvice === 'string') overrides.travelAdvice = body.travelAdvice;
      if (typeof body.heroTitle === 'string') overrides.heroTitle = body.heroTitle;
      if (typeof body.heroSubtitle === 'string') overrides.heroSubtitle = body.heroSubtitle;
      if (typeof body.seoTitle === 'string') overrides.seoTitle = body.seoTitle;
      if (typeof body.seoDescription === 'string') overrides.seoDescription = body.seoDescription;
      if (typeof body.contactEmail === 'string') overrides.contactEmail = body.contactEmail;
      if (typeof body.timezone === 'string') overrides.timezone = body.timezone;
      if (typeof body.colorPrimary === 'string') overrides.colorPrimary = body.colorPrimary;
      if (typeof body.colorSecondary === 'string') overrides.colorSecondary = body.colorSecondary;
      if (typeof body.showCountdown === 'boolean') overrides.showCountdown = body.showCountdown;
      if (typeof body.showAddToCalendar === 'boolean') {
        overrides.showAddToCalendar = body.showAddToCalendar;
      }
      if (typeof body.rsvpOpen === 'boolean') overrides.rsvpOpen = body.rsvpOpen;
      if (typeof body.rsvpClosedMessage === 'string') {
        overrides.rsvpClosedMessage = body.rsvpClosedMessage;
      }
      if (
        typeof body.themePreset === 'string' &&
        THEME_PRESET_KEYS.includes(body.themePreset as ThemePreset)
      ) {
        overrides.themePreset = body.themePreset as ThemePreset;
      }
      if (Array.isArray(body.features)) {
        overrides.features = body.features as DemoFeatureItem[];
      }
      if (body.modules && typeof body.modules === 'object' && !Array.isArray(body.modules)) {
        const mergedModules = resolveModuleConfig({
          ...getActiveArchetypeDataset().modules,
          ...(body.modules as Partial<ModuleConfig>),
        });
        overrides.modules = mergedModules;
      }

      updateDemoConfigOverrides(overrides);
      mutateActiveDataset((current) => ({
        ...current,
        ...(overrides.features ? { features: overrides.features } : {}),
        ...(overrides.modules ? { modules: overrides.modules } : {}),
        siteConfig: {
          ...current.siteConfig,
          ...(typeof body.autoApproveGuestPhotos === 'boolean'
            ? { autoApproveGuestPhotos: body.autoApproveGuestPhotos }
            : {}),
          ...(typeof body.rsvpOpen === 'boolean' ? { rsvpOpen: body.rsvpOpen } : {}),
          ...(typeof body.rsvpGracePeriodHours === 'number'
            ? { rsvpGracePeriodHours: body.rsvpGracePeriodHours }
            : {}),
          ...(typeof body.rsvpDeadlineDate === 'string' || body.rsvpDeadlineDate === null
            ? { rsvpDeadlineDate: body.rsvpDeadlineDate }
            : {}),
          ...(typeof body.rsvpClosedMessage === 'string'
            ? { rsvpClosedMessage: body.rsvpClosedMessage }
            : {}),
          ...(typeof body.timezone === 'string' ? { timezone: body.timezone } : {}),
          updatedAt: new Date().toISOString(),
        },
      }));

      const updated = getEffectiveDemoSettings();
      recordDemoAuditVersion(
        'AppConfig',
        'global',
        'UPDATE_SETTINGS',
        'Updated site settings configuration',
        updated
      );
      return jsonResponse({ success: true, data: updated });
    }

    if (method === 'DELETE') {
      return jsonResponse({ success: true, data: { deleted: true } });
    }
  }

  // 6. Invitation Codes Workflows (Catalog, Validate, Import, Export, Merge, RSVPs)
  if (path === '/api/admin/invitation-codes/catalog' && method === 'GET') {
    const search = (url.searchParams.get('search') || url.searchParams.get('q') || '')
      .trim()
      .toLowerCase();
    const limitParam = Number(url.searchParams.get('limit') || '0');
    let guests = getActiveArchetypeDataset().guests;
    if (search) {
      guests = guests.filter(
        (g) =>
          g.guestName.toLowerCase().includes(search) ||
          (g.householdName || '').toLowerCase().includes(search) ||
          g.code.toLowerCase().includes(search) ||
          (g.email || '').toLowerCase().includes(search) ||
          (g.members ?? []).some(
            (m) =>
              m.fullName.toLowerCase().includes(search) ||
              (m.email || '').toLowerCase().includes(search) ||
              (m.phone || '').toLowerCase().includes(search)
          )
      );
    }
    const effectiveLimit = limitParam > 0 ? limitParam : Math.max(50, guests.length);
    const items = limitParam > 0 ? guests.slice(0, limitParam) : guests;
    return jsonResponse(
      {
        success: true,
        data: {
          items,
          total: guests.length,
          page: 1,
          limit: effectiveLimit,
          totalPages: 1,
        },
      },
      200,
      buildPaginationHeaders(guests.length, 1, effectiveLimit)
    );
  }

  if (
    (path === '/api/admin/invitation-codes/validate' ||
      path === '/api/admin/invitation-codes/batch/validate') &&
    method === 'POST'
  ) {
    const body = await parseJsonBody(init, rawInput);
    const records = Array.isArray(body.records)
      ? body.records
      : Array.isArray(body.items)
        ? body.items
        : [];
    return jsonResponse({
      success: true,
      valid: true,
      validCount: records.length,
      invalidCount: 0,
      duplicateCount: 0,
      issues: [],
      data: {
        valid: true,
        validCount: records.length,
        invalidCount: 0,
        duplicateCount: 0,
        issues: [],
      },
    });
  }

  if (path === '/api/admin/invitation-codes/import' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const records = Array.isArray(body.records)
      ? (body.records as Array<Record<string, unknown>>)
      : Array.isArray(body.items)
        ? (body.items as Array<Record<string, unknown>>)
        : [];
    const nowIso = new Date().toISOString();
    const created: InvitationCodeDTO[] = records.map((rec, idx) => {
      const invId = `${nextDemoId('demo-imported')}-${idx}`;
      const rawMembers = Array.isArray(rec.members)
        ? (rec.members as Array<Record<string, unknown>>)
        : null;
      const explicitMembers: HouseholdMemberDTO[] | undefined =
        rawMembers && rawMembers.length > 0
          ? rawMembers.map((m, mIdx) => {
            const fullName = String(m.fullName || `Guest #${mIdx + 1}`).trim();
            const split = splitMemberFullName(fullName);
            const role: HouseholdMemberRole =
              mIdx === 0
                ? 'PRIMARY'
                : m.role === 'PARTNER' || m.role === 'CHILD' || m.role === 'PLUS_ONE'
                  ? m.role
                  : 'PARTNER';
            return {
              id: `${invId}-member-${mIdx + 1}`,
              invitationCodeId: invId,
              fullName,
              firstName: typeof m.firstName === 'string' ? m.firstName : split.firstName,
              lastName: typeof m.lastName === 'string' ? m.lastName : split.lastName,
              role,
              email: typeof m.email === 'string' && m.email.trim() ? m.email.trim() : null,
              phone: typeof m.phone === 'string' && m.phone.trim() ? m.phone.trim() : null,
              dietaryNotes:
                typeof m.dietaryNotes === 'string' && m.dietaryNotes.trim()
                  ? m.dietaryNotes.trim()
                  : null,
              tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
              displayOrder: mIdx,
              seatNumber: null,
              createdAt: nowIso,
              updatedAt: nowIso,
            };
          })
          : undefined;
      const base: InvitationCodeDTO = {
        id: invId,
        code: String(rec.code || `IMPORT${100 + idx}`).toUpperCase(),
        guestName: String(rec.guestName || `Imported Guest ${idx + 1}`),
        householdName: typeof rec.householdName === 'string' ? rec.householdName : '',
        email: typeof rec.email === 'string' && rec.email.trim() ? rec.email.trim() : null,
        addressLine1: typeof rec.addressLine1 === 'string' ? rec.addressLine1 : null,
        addressLine2: typeof rec.addressLine2 === 'string' ? rec.addressLine2 : null,
        city: typeof rec.city === 'string' ? rec.city : null,
        state: typeof rec.state === 'string' ? rec.state : null,
        zipCode: typeof rec.zipCode === 'string' ? rec.zipCode : null,
        country: typeof rec.country === 'string' ? rec.country : null,
        dietaryNotes: typeof rec.dietaryNotes === 'string' ? rec.dietaryNotes : null,
        partyGroup: typeof rec.partyGroup === 'string' ? rec.partyGroup : 'Imported',
        partyTags: Array.isArray(rec.partyTags) ? rec.partyTags.map(String) : [],
        plusOneAllocations: explicitMembers
          ? Math.max(Number(rec.plusOneAllocations || 0), explicitMembers.length - 1)
          : Number(rec.plusOneAllocations || 0),
        ...(rec.extraFields && typeof rec.extraFields === 'object'
          ? { extraFields: rec.extraFields as Record<string, unknown> }
          : {}),
        used: false,
        isSample: false,
      };
      return {
        ...base,
        members: explicitMembers ?? buildDemoHouseholdMembersForGuest(base),
      };
    });
    if (created.length > 0) {
      mutateActiveDataset((current) => ({
        ...current,
        guests: [...current.guests, ...created],
      }));
      upsertInvitationsIntoStaticDemoStore(created);
    }
    return jsonResponse({
      success: true,
      count: created.length,
      imported: created.length,
      records: created,
      data: {
        importedCount: created.length,
        createdCount: created.length,
        updatedCount: 0,
        skippedCount: 0,
        items: created,
      },
    });
  }

  if (path === '/api/admin/invitation-codes/export' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const tableById = new Map(dataset.seatingTables.map((t) => [t.id, t.name]));
    const idsFilter = (url.searchParams.get('ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const search = (url.searchParams.get('search') || url.searchParams.get('q') || '')
      .trim()
      .toLowerCase();
    const statusFilter = (url.searchParams.get('status') || '').trim().toLowerCase();
    const partyGroupFilter = (url.searchParams.get('partyGroup') || '').trim().toLowerCase();
    const partyTagsFilter = (url.searchParams.get('partyTags') || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    let guests = dataset.guests;
    if (idsFilter.length > 0) {
      const idSet = new Set(idsFilter);
      guests = guests.filter((g) => idSet.has(g.id));
    }
    if (search) {
      guests = guests.filter(
        (g) =>
          g.guestName.toLowerCase().includes(search) ||
          (g.householdName || '').toLowerCase().includes(search) ||
          g.code.toLowerCase().includes(search)
      );
    }
    if (statusFilter === 'used' || statusFilter === 'redeemed') {
      guests = guests.filter(
        (g) => Boolean(g.used) || dataset.subEventRsvps.some((r) => r.invitationCodeId === g.id)
      );
    } else if (statusFilter === 'unused') {
      guests = guests.filter(
        (g) => !g.used && !dataset.subEventRsvps.some((r) => r.invitationCodeId === g.id)
      );
    }
    if (partyGroupFilter && partyGroupFilter !== 'all') {
      guests = guests.filter((g) => (g.partyGroup || '').toLowerCase() === partyGroupFilter);
    }
    if (partyTagsFilter.length > 0) {
      guests = guests.filter((g) =>
        (g.partyTags || []).some((t) => partyTagsFilter.includes(t.toLowerCase()))
      );
    }

    const csv = buildDemoCsv(
      [
        'Code',
        'Guest Name',
        'Email',
        'Household',
        'Party Group',
        'Party Tags',
        'Plus Ones',
        'Dietary Notes',
        'Table',
        'Seat',
        'Used',
        'Address Line 1',
        'City',
        'State',
        'Zip',
        'Country',
      ],
      guests.map((g) => {
        const guestRsvps = dataset.subEventRsvps.filter((r) => r.invitationCodeId === g.id);
        const extraRecord =
          g.extraFields && typeof g.extraFields === 'object' ? g.extraFields : null;
        const isDeclined =
          (guestRsvps.length > 0 && guestRsvps.every((r) => r.status === 'DECLINED')) ||
          (typeof extraRecord?.attendanceStatus === 'string' &&
            extraRecord.attendanceStatus.trim().toLowerCase() === 'declined');
        const confirmedPlusOnes =
          guestRsvps.length > 0
            ? guestRsvps.reduce(
              (max, r) => (r.status === 'ATTENDING' ? Math.max(max, r.plusOneCount ?? 0) : max),
              0
            )
            : typeof extraRecord?.plusOneCount === 'number'
              ? extraRecord.plusOneCount
              : null;
        const rsvpDietary = Array.from(
          new Set(guestRsvps.map((r) => (r.dietaryNotes || '').trim()).filter(Boolean))
        ).join('; ');
        const resolvedDietary = rsvpDietary || (g.dietaryNotes ?? '');
        const isUsed = Boolean(g.used) || guestRsvps.length > 0;

        return [
          g.code,
          g.guestName,
          g.email ?? '',
          g.householdName ?? '',
          g.partyGroup ?? '',
          (g.partyTags ?? []).join('; '),
          isDeclined ? 0 : (confirmedPlusOnes ?? g.plusOneAllocations ?? 0),
          resolvedDietary,
          g.tableId ? (tableById.get(g.tableId) ?? '') : '',
          g.seatNumber ?? '',
          isUsed ? 'Yes' : 'No',
          g.addressLine1 ?? '',
          g.city ?? '',
          g.state ?? '',
          g.zipCode ?? '',
          g.country ?? '',
        ];
      })
    );
    return binaryResponse(
      csv,
      'text/csv; charset=utf-8',
      `invitation-codes-${new Date().toISOString().slice(0, 10)}.csv`
    );
  }

  if (path === '/api/admin/invitation-codes/merge' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const primaryId = typeof body.primaryId === 'string' ? body.primaryId.trim() : '';
    const secondaryIds = Array.isArray(body.secondaryIds)
      ? body.secondaryIds.filter((id): id is string => typeof id === 'string' && id !== primaryId)
      : [];

    if (!primaryId || secondaryIds.length === 0) {
      return jsonResponse(
        { success: false, error: 'Primary ID and at least one secondary ID are required.' },
        400
      );
    }

    const secSet = new Set(secondaryIds);
    let mergedPrimary: InvitationCodeDTO | null = null;
    let mergedCount = 0;
    const transferredCounts = {
      contributors: 0,
      subEventAccesses: 0,
      subEventRsvps: 0,
      broadcastRecipients: 0,
      seatTransferred: false,
    };

    mutateActiveDataset((current) => {
      const primary = current.guests.find((g) => g.id === primaryId);
      if (!primary) return current;

      let nextPrimary: InvitationCodeDTO = { ...primary };
      const secondaries = current.guests.filter((g) => secSet.has(g.id));
      mergedCount = secondaries.length;

      const mergedMembers: HouseholdMemberDTO[] = [...buildDemoHouseholdMembersForGuest(primary)];
      const seenMemberKeys = new Set(
        mergedMembers.map((m) => `${m.fullName.toLowerCase()}::${(m.email || '').toLowerCase()}`)
      );

      for (const sec of secondaries) {
        if (!nextPrimary.email && sec.email) nextPrimary.email = sec.email;
        if (!nextPrimary.addressLine1 && sec.addressLine1) {
          nextPrimary.addressLine1 = sec.addressLine1;
          nextPrimary.addressLine2 = sec.addressLine2;
          nextPrimary.city = sec.city;
          nextPrimary.state = sec.state;
          nextPrimary.zipCode = sec.zipCode;
          nextPrimary.country = sec.country;
        }
        if (!nextPrimary.tableId && sec.tableId) {
          nextPrimary.tableId = sec.tableId;
          nextPrimary.seatNumber = sec.seatNumber;
          nextPrimary.plusOneSeatNumbers = sec.plusOneSeatNumbers ?? [];
          transferredCounts.seatTransferred = true;
        }
        for (const sm of buildDemoHouseholdMembersForGuest(sec)) {
          const key = `${sm.fullName.toLowerCase()}::${(sm.email || '').toLowerCase()}`;
          if (seenMemberKeys.has(key)) continue;
          seenMemberKeys.add(key);
          mergedMembers.push({
            ...sm,
            id: `${primaryId}-member-${mergedMembers.length + 1}`,
            invitationCodeId: primaryId,
            role: sm.role === 'PRIMARY' ? 'PARTNER' : sm.role,
            displayOrder: mergedMembers.length,
          });
        }
        nextPrimary = {
          ...nextPrimary,
          plusOneAllocations: Math.max(
            nextPrimary.plusOneAllocations ?? 0,
            sec.plusOneAllocations ?? 0,
            Math.max(0, mergedMembers.length - 1)
          ),
          partyTags: Array.from(new Set([...(nextPrimary.partyTags ?? []), ...(sec.partyTags ?? [])])),
          members: mergedMembers,
        };
      }
      mergedPrimary = nextPrimary;

      const nextRegistryItems = current.registryItems.map((item) => ({
        ...item,
        contributors: (item.contributors || []).map((c) => {
          if (c.invitationCodeId && secSet.has(c.invitationCodeId)) {
            transferredCounts.contributors += 1;
            return { ...c, invitationCodeId: primaryId };
          }
          return c;
        }),
      }));

      const nextOffline = current.offlineContributors.map((c) => {
        if (c.invitationCodeId && secSet.has(c.invitationCodeId)) {
          transferredCounts.contributors += 1;
          return { ...c, invitationCodeId: primaryId };
        }
        return c;
      });

      const primaryAccessEvents = new Set(
        current.subEventAccess
          .filter((a) => a.invitationCodeId === primaryId)
          .map((a) => a.subEventId)
      );
      const nextSubEventAccess = current.subEventAccess.flatMap((a) => {
        if (!secSet.has(a.invitationCodeId)) return [a];
        if (primaryAccessEvents.has(a.subEventId)) return [];
        primaryAccessEvents.add(a.subEventId);
        transferredCounts.subEventAccesses += 1;
        return [{ ...a, invitationCodeId: primaryId }];
      });

      const primaryRsvpEvents = new Set(
        current.subEventRsvps
          .filter((r) => r.invitationCodeId === primaryId)
          .map((r) => r.subEventId)
      );
      const nextSubEventRsvps = current.subEventRsvps.flatMap((r) => {
        if (!secSet.has(r.invitationCodeId)) return [r];
        if (primaryRsvpEvents.has(r.subEventId)) return [];
        primaryRsvpEvents.add(r.subEventId);
        transferredCounts.subEventRsvps += 1;
        return [
          {
            ...r,
            invitationCodeId: primaryId,
            guestCode: nextPrimary.code,
            guestName: nextPrimary.guestName,
          },
        ];
      });

      const nextBroadcasts = current.broadcastMessages.map((b) => ({
        ...b,
        recipients: b.recipients.map((rcpt) => {
          if (rcpt.invitationCodeId && secSet.has(rcpt.invitationCodeId)) {
            transferredCounts.broadcastRecipients += 1;
            return { ...rcpt, invitationCodeId: primaryId };
          }
          return rcpt;
        }),
      }));

      const nextGuests = current.guests
        .filter((g) => !secSet.has(g.id))
        .map((g) => (g.id === primaryId ? nextPrimary : g));

      return {
        ...current,
        guests: nextGuests,
        registryItems: nextRegistryItems,
        offlineContributors: nextOffline,
        subEventAccess: nextSubEventAccess,
        subEventRsvps: nextSubEventRsvps,
        broadcastMessages: nextBroadcasts,
      };
    });

    if (!mergedPrimary) {
      return jsonResponse({ success: false, error: 'Primary invitation code not found.' }, 404);
    }

    const finalPrimary: InvitationCodeDTO = mergedPrimary;
    recordDemoAuditVersion(
      'InvitationCode',
      finalPrimary.id,
      'MERGE',
      `Merged ${mergedCount} duplicate household record(s) into ${finalPrimary.guestName}`,
      finalPrimary as unknown as Record<string, unknown>
    );

    const resultPayload = {
      success: true,
      record: finalPrimary,
      primary: finalPrimary,
      mergedCount,
      transferredCounts,
    };
    return jsonResponse({ ...resultPayload, data: resultPayload });
  }

  if (path === '/api/admin/invitation-codes/rsvps') {
    if (method === 'GET') {
      const dataset = getActiveArchetypeDataset();
      const invitationCodeId = (url.searchParams.get('invitationCodeId') || '').trim();
      const targetGuest = invitationCodeId
        ? dataset.guests.find((g) => g.id === invitationCodeId) ?? null
        : null;

      if (!invitationCodeId) {
        const allClientRsvps = dataset.subEventRsvps.map((r) => ({
          ...r,
          status: r.status.toLowerCase(),
        }));
        return jsonResponse({
          success: true,
          items: allClientRsvps,
          data: allClientRsvps,
        });
      }

      const targetMembers = targetGuest ? buildDemoHouseholdMembersForGuest(targetGuest) : [];
      const inviteDto = targetGuest
        ? {
          id: targetGuest.id,
          code: targetGuest.code,
          guestName: targetGuest.guestName,
          used: Boolean(targetGuest.used),
          plusOneAllocations: targetGuest.plusOneAllocations ?? 0,
          plusOneFirstName: targetGuest.plusOneFirstName ?? null,
          plusOneLastName: targetGuest.plusOneLastName ?? null,
          dietaryNotes: targetGuest.dietaryNotes ?? null,
          extraFields: targetGuest.extraFields ?? null,
          members: targetMembers,
        }
        : {
          id: invitationCodeId,
          code: 'DEMO',
          guestName: 'Invited Guest',
          used: false,
          plusOneAllocations: 0,
          plusOneFirstName: null,
          plusOneLastName: null,
          dietaryNotes: null,
          extraFields: null,
          members: [],
        };

      const accessSet = new Set(
        dataset.subEventAccess
          .filter((a) => a.invitationCodeId === invitationCodeId)
          .map((a) => a.subEventId)
      );
      const subEvents = dataset.subEvents.map((ev) => ({
        id: ev.id,
        title: ev.title,
        isPrivate: Boolean(ev.isPrivate),
        hasAccess: !ev.isPrivate || accessSet.has(ev.id),
        mealOptions: ev.mealOptions ?? [],
        customQuestions: ev.customQuestions ?? [],
      }));
      const rsvps = dataset.subEventRsvps
        .filter((r) => r.invitationCodeId === invitationCodeId)
        .map((r) => ({
          id: r.id,
          subEventId: r.subEventId,
          status: r.status.toLowerCase() as 'attending' | 'declined' | 'pending',
          plusOneCount: r.plusOneCount,
          plusOneNames: r.plusOneNames,
          mealSelections: r.mealSelections,
          dietaryNotes: r.dietaryNotes || null,
          customAnswers: r.customAnswers,
          memberRsvps: (r.memberRsvps ?? []).map((mr) => ({
            id: mr.id,
            subEventRsvpId: mr.subEventRsvpId ?? r.id,
            householdMemberId: mr.householdMemberId,
            status: mr.status,
            mealOptionId: mr.mealOptionId ?? null,
            dietaryNotes: mr.dietaryNotes ?? null,
          })),
        }));

      const detail = { invitationCode: inviteDto, subEvents, rsvps };
      return jsonResponse({ success: true, ...detail, data: detail });
    }

    if (method === 'PUT' || method === 'POST') {
      const body = await parseJsonBody(init, rawInput);
      const nowIso = new Date().toISOString();

      if (Array.isArray(body.invitationCodeIds)) {
        const ids = body.invitationCodeIds.filter((id): id is string => typeof id === 'string');
        const idSet = new Set(ids);
        const rawStatus = String(body.status ?? 'attending').toLowerCase();
        const targetEventIds = Array.isArray(body.subEventIds)
          ? body.subEventIds.map(String)
          : getActiveArchetypeDataset().subEvents.map((e) => e.id);

        mutateActiveDataset((current) => {
          let nextRsvps = [...current.subEventRsvps];
          if (rawStatus === 'clear') {
            nextRsvps = nextRsvps.filter(
              (r) => !(idSet.has(r.invitationCodeId) && targetEventIds.includes(r.subEventId))
            );
          } else {
            const storedStatus: DemoSubEventRsvpRecord['status'] =
              rawStatus === 'declined'
                ? 'DECLINED'
                : rawStatus === 'pending'
                  ? 'PENDING'
                  : 'ATTENDING';
            for (const invId of ids) {
              const guest = current.guests.find((g) => g.id === invId);
              if (!guest) continue;
              for (const evId of targetEventIds) {
                const idx = nextRsvps.findIndex(
                  (r) => r.invitationCodeId === invId && r.subEventId === evId
                );
                const rec: DemoSubEventRsvpRecord = {
                  id: idx >= 0 ? nextRsvps[idx].id : nextDemoId('demo-rsvp'),
                  subEventId: evId,
                  invitationCodeId: invId,
                  guestCode: guest.code,
                  guestName: guest.guestName,
                  status: storedStatus,
                  plusOneCount: idx >= 0 ? nextRsvps[idx].plusOneCount : 0,
                  plusOneNames: idx >= 0 ? nextRsvps[idx].plusOneNames : [],
                  mealSelection: idx >= 0 ? nextRsvps[idx].mealSelection : null,
                  mealSelections: idx >= 0 ? nextRsvps[idx].mealSelections : [],
                  dietaryNotes: idx >= 0 ? nextRsvps[idx].dietaryNotes : '',
                  customAnswers: idx >= 0 ? nextRsvps[idx].customAnswers : {},
                  respondedAt: idx >= 0 ? nextRsvps[idx].respondedAt : nowIso,
                  updatedAt: nowIso,
                };
                if (idx >= 0) nextRsvps[idx] = rec;
                else nextRsvps.push(rec);
              }
            }
          }
          return {
            ...current,
            subEventRsvps: nextRsvps,
            guests: current.guests.map((g) =>
              idSet.has(g.id)
                ? { ...g, used: rawStatus !== 'pending' && rawStatus !== 'clear' }
                : g
            ),
          };
        });
        return jsonResponse({
          success: true,
          updatedCount: ids.length,
          data: { updatedCount: ids.length },
        });
      }

      const invitationCodeId = String(body.invitationCodeId ?? '').trim();
      if (!invitationCodeId) {
        return jsonResponse({ success: false, error: 'invitationCodeId is required.' }, 400);
      }

      mutateActiveDataset((current) => {
        const guest = current.guests.find((g) => g.id === invitationCodeId);
        if (!guest) return current;
        let nextRsvps = [...current.subEventRsvps];
        if (body.clearAll === true) {
          nextRsvps = nextRsvps.filter((r) => r.invitationCodeId !== invitationCodeId);
        } else if (Array.isArray(body.rsvps)) {
          for (const entry of body.rsvps as Array<Record<string, unknown>>) {
            const evId = String(entry.subEventId ?? '').trim();
            if (!evId) continue;
            const st = String(entry.status ?? 'attending').toLowerCase();
            if (st === 'clear') {
              nextRsvps = nextRsvps.filter(
                (r) => !(r.invitationCodeId === invitationCodeId && r.subEventId === evId)
              );
              continue;
            }
            const idx = nextRsvps.findIndex(
              (r) => r.invitationCodeId === invitationCodeId && r.subEventId === evId
            );
            const rsvpId = idx >= 0 ? nextRsvps[idx].id : nextDemoId('demo-rsvp');
            const guestMembers = buildDemoHouseholdMembersForGuest(guest);
            const memberById = new Map(guestMembers.map((m) => [m.id, m]));
            let storedStatus: DemoSubEventRsvpRecord['status'] =
              st === 'declined' ? 'DECLINED' : st === 'pending' ? 'PENDING' : 'ATTENDING';
            let plusOneCount = Math.max(0, Number(entry.plusOneCount ?? 0) || 0);
            let meals = Array.isArray(entry.mealSelections)
              ? entry.mealSelections.map(String)
              : [];
            let plusOneNames = Array.isArray(entry.plusOneNames)
              ? entry.plusOneNames.map(String)
              : [];
            let memberRsvps: DemoSubEventMemberRsvpRecord[] | undefined;

            if (Array.isArray(entry.memberRsvps) && entry.memberRsvps.length > 0) {
              memberRsvps = (entry.memberRsvps as Array<Record<string, unknown>>)
                .filter((mr) => typeof mr.householdMemberId === 'string')
                .map((mr, mIdx) => {
                  const rawMst = String(mr.status ?? 'pending').toLowerCase();
                  const mst: 'attending' | 'declined' | 'pending' =
                    rawMst === 'attending'
                      ? 'attending'
                      : rawMst === 'declined'
                        ? 'declined'
                        : 'pending';
                  return {
                    id: `${rsvpId}-mr-${mIdx + 1}`,
                    subEventRsvpId: rsvpId,
                    householdMemberId: String(mr.householdMemberId),
                    status: mst,
                    mealOptionId:
                      mst === 'attending' && typeof mr.mealOptionId === 'string' && mr.mealOptionId
                        ? mr.mealOptionId
                        : null,
                    dietaryNotes:
                      mst !== 'declined' && typeof mr.dietaryNotes === 'string'
                        ? mr.dietaryNotes
                        : null,
                  };
                });
              const attendingMr = memberRsvps.filter((mr) => mr.status === 'attending');
              const anyPending = memberRsvps.some((mr) => mr.status === 'pending');
              storedStatus =
                attendingMr.length > 0
                  ? 'ATTENDING'
                  : anyPending
                    ? 'PENDING'
                    : 'DECLINED';
              plusOneCount =
                storedStatus === 'ATTENDING' ? Math.max(0, attendingMr.length - 1) : 0;
              meals = attendingMr
                .map((mr) => mr.mealOptionId)
                .filter((id): id is string => Boolean(id));
              plusOneNames = attendingMr
                .map((mr) => memberById.get(mr.householdMemberId))
                .filter((m): m is HouseholdMemberDTO => Boolean(m && m.role !== 'PRIMARY'))
                .map((m) => m.fullName);
            }

            const rec: DemoSubEventRsvpRecord = {
              id: rsvpId,
              subEventId: evId,
              invitationCodeId,
              guestCode: guest.code,
              guestName: guest.guestName,
              status: storedStatus,
              plusOneCount,
              plusOneNames,
              mealSelection: meals[0] ?? null,
              mealSelections: meals,
              dietaryNotes: typeof entry.dietaryNotes === 'string' ? entry.dietaryNotes : '',
              customAnswers:
                entry.customAnswers && typeof entry.customAnswers === 'object'
                  ? (entry.customAnswers as Record<string, string>)
                  : {},
              ...(memberRsvps ? { memberRsvps } : {}),
              respondedAt: idx >= 0 ? nextRsvps[idx].respondedAt : nowIso,
              updatedAt: nowIso,
            };
            if (idx >= 0) nextRsvps[idx] = rec;
            else nextRsvps.push(rec);
          }
        }
        return {
          ...current,
          subEventRsvps: nextRsvps,
          guests: current.guests.map((g) =>
            g.id === invitationCodeId ? { ...g, used: !body.clearAll } : g
          ),
        };
      });

      return jsonResponse({ success: true, data: { invitationCodeId } });
    }
  }

  // 7. Sub-Events Access Matrix & RSVP Summary
  if (path === '/api/admin/sub-events/rsvp-summary' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const invitations = dataset.guests.filter(
      (inv) => !inv.isSample && !isDemoAddressCollectionOnly(inv.partyTags)
    );
    const activePool = invitations.length > 0
      ? invitations
      : dataset.guests.filter((inv) => !isDemoAddressCollectionOnly(inv.partyTags));
    const eligibleIds = new Set(activePool.map((g) => g.id));

    let attendingHouseholds = 0;
    let declinedHouseholds = 0;
    let pendingHouseholds = 0;
    let attendingHeadcount = 0;
    let attendingPlusOnes = 0;
    let declinedHeadcount = 0;
    let pendingHeadcount = 0;
    const globalDietary = createEmptyDietary();

    for (const inv of activePool) {
      const invRsvps = dataset.subEventRsvps.filter((r) => r.invitationCodeId === inv.id);
      const hasAttending = invRsvps.some((r) => r.status === 'ATTENDING');
      const allDeclined =
        invRsvps.length > 0 && invRsvps.every((r) => r.status === 'DECLINED');
      const maxPlusOnes = invRsvps.reduce(
        (mx, r) => (r.status === 'ATTENDING' ? Math.max(mx, r.plusOneCount) : mx),
        0
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

      const notes = [inv.dietaryNotes, ...invRsvps.map((r) => r.dietaryNotes)]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (notes.trim()) {
        globalDietary.totalWithRestrictions += 1;
        if (notes.includes('gluten')) globalDietary.glutenFree += 1;
        if (notes.includes('vegetarian')) globalDietary.vegetarian += 1;
        if (notes.includes('vegan')) globalDietary.vegan += 1;
        if (notes.includes('dairy')) globalDietary.dairyFree += 1;
        if (notes.includes('nut') || notes.includes('allergy')) globalDietary.nutFree += 1;
      }
    }

    const subEventItems: SubEventRsvpSummaryItem[] = dataset.subEvents.map((ev) => {
      const invitedCount = ev.isPrivate
        ? dataset.subEventAccess.filter(
          (a) => a.subEventId === ev.id && eligibleIds.has(a.invitationCodeId)
        ).length
        : activePool.length;
      const rsvps = dataset.subEventRsvps.filter(
        (r) => r.subEventId === ev.id && eligibleIds.has(r.invitationCodeId)
      );
      const attending = rsvps.filter((r) => r.status === 'ATTENDING');
      const declined = rsvps.filter((r) => r.status === 'DECLINED');
      const plusOnes = attending.reduce((sum, r) => sum + r.plusOneCount, 0);
      const mealOptions = ev.mealOptions ?? [];
      const mealCounts = mealOptions.map((opt) => ({
        optionId: opt.id,
        label: opt.label,
        dietaryTags: opt.dietaryTags ?? [],
        count: attending.reduce(
          (sum, r) => sum + r.mealSelections.filter((m) => m === opt.id).length,
          0
        ),
      }));

      return {
        subEventId: ev.id,
        title: ev.title,
        isPrivate: Boolean(ev.isPrivate),
        invitedCount,
        attendingCount: attending.length,
        attendingPlusOnes: plusOnes,
        attendingHeadcount: attending.length + plusOnes,
        declinedCount: declined.length,
        pendingCount: Math.max(0, invitedCount - attending.length - declined.length),
        kidsCount: 0,
        mealCounts,
        dietaryCounts: createEmptyDietary(),
        questionBreakdowns: [],
      };
    });

    const summary: RsvpSummaryResponse = {
      global: {
        totalInvitations: activePool.length,
        attendingHouseholds,
        declinedHouseholds,
        pendingHouseholds,
        attendingHeadcount,
        attendingPlusOnes,
        declinedHeadcount,
        pendingHeadcount,
        dietary: globalDietary,
        mealTotals: subEventItems.flatMap((item) =>
          item.mealCounts.map((mc) => ({
            ...mc,
            subEventId: item.subEventId,
            subEventTitle: item.title,
          }))
        ),
        questionBreakdowns: [],
      },
      subEvents: subEventItems,
    };

    return jsonResponse({ success: true, data: summary });
  }

  if (
    path === '/api/admin/sub-events/access' ||
    path === '/api/admin/sub-events/access/batch'
  ) {
    if (method === 'GET') {
      const dataset = getActiveArchetypeDataset();
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
      const limit = Math.max(1, parseInt(url.searchParams.get('limit') || '25', 10) || 25);
      const search = (url.searchParams.get('search') || '').trim().toLowerCase();
      const partyTag = (url.searchParams.get('partyTag') || '').trim().toLowerCase();
      const partyGroup = (url.searchParams.get('partyGroup') || '').trim().toLowerCase();
      const householdName = (url.searchParams.get('householdName') || '').trim().toLowerCase();

      const nonAddressGuests = dataset.guests.filter(
        (g) => !isDemoAddressCollectionOnly(g.partyTags)
      );
      const filterOptions = {
        partyTags: Array.from(
          new Set(nonAddressGuests.flatMap((g) => g.partyTags || []).filter(Boolean))
        ),
        partyGroups: Array.from(
          new Set(nonAddressGuests.map((g) => g.partyGroup || '').filter(Boolean))
        ),
        householdNames: Array.from(
          new Set(nonAddressGuests.map((g) => g.householdName || '').filter(Boolean))
        ),
      };

      const filteredGuests = nonAddressGuests.filter((g) => {
        if (
          search &&
          !g.guestName.toLowerCase().includes(search) &&
          !g.code.toLowerCase().includes(search) &&
          !(g.householdName || '').toLowerCase().includes(search)
        ) {
          return false;
        }
        if (
          partyTag &&
          !(g.partyTags || []).some((t) => t.toLowerCase() === partyTag)
        ) {
          return false;
        }
        if (partyGroup && (g.partyGroup || '').toLowerCase() !== partyGroup) {
          return false;
        }
        if (householdName && (g.householdName || '').toLowerCase() !== householdName) {
          return false;
        }
        return true;
      });

      const total = filteredGuests.length;
      const totalPages = Math.max(1, Math.ceil(total / limit));
      const pagedGuests = filteredGuests.slice((page - 1) * limit, page * limit);

      const invitationCodes = pagedGuests.map((g) => {
        const allowedSubEventIds = dataset.subEvents
          .filter(
            (ev) =>
              !ev.isPrivate ||
              dataset.subEventAccess.some(
                (a) => a.subEventId === ev.id && a.invitationCodeId === g.id
              )
          )
          .map((ev) => ev.id);

        const eventRsvps: Record<string, AccessMatrixGuestEventRsvp> = {};
        for (const ev of dataset.subEvents) {
          const rsvp = dataset.subEventRsvps.find(
            (r) => r.subEventId === ev.id && r.invitationCodeId === g.id
          );
          if (!rsvp) continue;
          const mealMap = new Map((ev.mealOptions ?? []).map((m) => [m.id, m]));
          eventRsvps[ev.id] = {
            status: rsvp.status.toLowerCase() as 'attending' | 'declined' | 'pending',
            plusOneCount: rsvp.plusOneCount,
            plusOneNames: rsvp.plusOneNames,
            dietaryNotes: rsvp.dietaryNotes || null,
            meals: rsvp.mealSelections.map((optId, idx) => {
              const meal = mealMap.get(optId);
              return {
                attendee: idx === 0 ? g.guestName : rsvp.plusOneNames[idx - 1] || `Guest +${idx}`,
                optionId: optId,
                label: meal?.label || optId,
                dietaryTags: meal?.dietaryTags ?? [],
              };
            }),
            answers: Object.entries(rsvp.customAnswers || {}).map(([qId, ans]) => {
              const q = (ev.customQuestions ?? []).find((cq) => cq.id === qId);
              return {
                questionId: qId,
                prompt: q?.prompt || qId,
                answer: ans,
              };
            }),
          };
        }

        return {
          id: g.id,
          code: g.code,
          guestName: g.guestName,
          householdName: g.householdName ?? null,
          partyGroup: g.partyGroup ?? null,
          partyTags: g.partyTags ?? [],
          allowedSubEventIds,
          eventRsvps,
        };
      });

      return jsonResponse({
        success: true,
        data: {
          subEvents: dataset.subEvents,
          invitationCodes,
          pagination: {
            total,
            page,
            limit,
            totalPages,
          },
          filterOptions,
        },
      });
    }

    if (method === 'PUT' && path === '/api/admin/sub-events/access') {
      const body = await parseJsonBody(init, rawInput);
      const invitationCodeId = String(body.invitationCodeId ?? '').trim();
      const allowedSubEventIds = Array.isArray(body.allowedSubEventIds)
        ? body.allowedSubEventIds.map(String)
        : null;

      if (!invitationCodeId) {
        return jsonResponse({ success: false, error: 'invitationCodeId is required.' }, 400);
      }

      const nowIso = new Date().toISOString();
      mutateActiveDataset((current) => {
        if (allowedSubEventIds) {
          const allowedSet = new Set(allowedSubEventIds);
          const privateEventIds = new Set(
            current.subEvents.filter((e) => e.isPrivate).map((e) => e.id)
          );
          const filteredExisting = current.subEventAccess.filter(
            (a) => a.invitationCodeId !== invitationCodeId
          );
          const additions = Array.from(allowedSet)
            .filter((evId) => privateEventIds.has(evId))
            .map((evId) => ({
              id: nextDemoId('demo-access'),
              subEventId: evId,
              invitationCodeId,
              createdAt: nowIso,
            }));
          return {
            ...current,
            subEventAccess: [...filteredExisting, ...additions],
          };
        }
        return current;
      });

      return jsonResponse({
        success: true,
        data: { invitationCodeId, allowedSubEventIds: allowedSubEventIds ?? [] },
      });
    }

    if (method === 'POST' || method === 'PUT') {
      const body = await parseJsonBody(init, rawInput);
      const subEventIds = Array.isArray(body.subEventIds)
        ? body.subEventIds.map(String)
        : typeof body.subEventId === 'string' && body.subEventId
          ? [body.subEventId]
          : [];
      const action = body.action === 'revoke' || body.grant === false ? 'revoke' : 'grant';
      const explicitGuestIds = Array.isArray(body.invitationCodeIds)
        ? new Set(body.invitationCodeIds.map(String))
        : typeof body.invitationCodeId === 'string'
          ? new Set([body.invitationCodeId])
          : null;

      let updatedCount = 0;
      const nowIso = new Date().toISOString();

      mutateActiveDataset((current) => {
        const targetGuests = current.guests.filter((g) => {
          if (isDemoAddressCollectionOnly(g.partyTags)) return false;
          if (explicitGuestIds && !explicitGuestIds.has(g.id)) return false;
          return true;
        });

        let nextAccess = [...current.subEventAccess];
        for (const guest of targetGuests) {
          for (const evId of subEventIds) {
            const existingIdx = nextAccess.findIndex(
              (a) => a.subEventId === evId && a.invitationCodeId === guest.id
            );
            if (action === 'grant' && existingIdx === -1) {
              nextAccess.push({
                id: nextDemoId('demo-access'),
                subEventId: evId,
                invitationCodeId: guest.id,
                createdAt: nowIso,
              });
              updatedCount += 1;
            } else if (action === 'revoke' && existingIdx !== -1) {
              nextAccess = nextAccess.filter((_, idx) => idx !== existingIdx);
              updatedCount += 1;
            }
          }
        }
        return {
          ...current,
          subEventAccess: nextAccess,
        };
      });

      return jsonResponse({
        success: true,
        count: updatedCount,
        updatedCount,
        data: { count: updatedCount, updatedCount },
      });
    }

    if (method === 'DELETE') {
      const body = await parseJsonBody(init, rawInput);
      const subEventId = url.searchParams.get('subEventId') || String(body.subEventId ?? '');
      const invitationCodeId =
        url.searchParams.get('invitationCodeId') || String(body.invitationCodeId ?? '');
      mutateActiveDataset((current) => ({
        ...current,
        subEventAccess: current.subEventAccess.filter(
          (a) => !(a.subEventId === subEventId && a.invitationCodeId === invitationCodeId)
        ),
      }));
      return jsonResponse({ success: true });
    }
  }

  // 8. Broadcast History, Preview, Send, Retry, Schedule & Cron (Zero External Calls)
  if (path === '/api/admin/broadcast/history' && method === 'GET') {
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50)
    );
    const all = getActiveArchetypeDataset()
      .broadcastMessages.slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toBroadcastHistoryDto);
    const total = all.length;
    const paged = all.slice((page - 1) * limit, page * limit);
    return jsonResponse(
      { success: true, data: paged },
      200,
      buildPaginationHeaders(total, page, limit)
    );
  }

  if (path === '/api/admin/broadcast/preview' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const dataset = getActiveArchetypeDataset();
    const settings = getEffectiveDemoSettings();
    const p1 = String(settings.partner1Name || 'Alex');
    const p2 = String(settings.partner2Name || 'Taylor');
    const baseUrl = String(settings.baseUrl || url.origin);
    const sampleGuest = dataset.guests[0] ?? {
      guestName: 'Jordan & Casey',
      code: 'DEMO2026',
      householdName: 'Jordan Household',
    };
    const rawSubject =
      typeof body.subject === 'string' && body.subject
        ? body.subject
        : `Update from ${p1} & ${p2}`;
    const rawBody = typeof body.body === 'string' ? body.body : '';
    const renderedSubject = interpolateBroadcastTemplate(rawSubject, sampleGuest, p1, p2, baseUrl);
    const renderedBody = interpolateBroadcastTemplate(rawBody, sampleGuest, p1, p2, baseUrl);

    const eligibleGuests = dataset.guests.filter(
      (g) => !isDemoAddressCollectionOnly(g.partyTags)
    );
    const expandedContacts = eligibleGuests.flatMap((g) => {
      const adultMembers = buildDemoHouseholdMembersForGuest(g).filter(
        (m) => m.role !== 'CHILD' && Boolean(m.email?.trim())
      );
      if (adultMembers.length === 0) {
        return [{ id: g.id, guestName: g.guestName, email: g.email ?? null, code: g.code }];
      }
      const seenEmails = new Set<string>();
      const rows: Array<{ id: string; guestName: string; email: string | null; code: string }> = [];
      for (const m of adultMembers) {
        const lower = m.email!.trim().toLowerCase();
        if (seenEmails.has(lower)) continue;
        seenEmails.add(lower);
        rows.push({
          id: g.id,
          guestName: m.fullName,
          email: m.email!.trim(),
          code: g.code,
        });
      }
      return rows;
    });
    const payload = {
      subject: renderedSubject,
      body: renderedBody,
      html: `<div style="font-family:sans-serif;line-height:1.5">${renderedBody.replace(/\n/g, '<br/>')}</div>`,
      recipientCount: expandedContacts.length,
      matchedCount: eligibleGuests.length,
      missingContactCount: eligibleGuests.filter((g) => {
        if (g.email?.trim()) return false;
        return !buildDemoHouseholdMembersForGuest(g).some(
          (m) => m.role !== 'CHILD' && Boolean(m.email?.trim())
        );
      }).length,
      matchedGuests: expandedContacts,
    };
    return jsonResponse({ success: true, ...payload, data: payload });
  }

  if (
    (path === '/api/admin/broadcast/send' || path === '/api/admin/broadcast') &&
    method === 'POST'
  ) {
    const body = await parseJsonBody(init, rawInput);
    const channel: 'EMAIL' | 'SMS' = body.channel === 'SMS' ? 'SMS' : 'EMAIL';
    const subject =
      typeof body.subject === 'string' && body.subject.trim()
        ? body.subject.trim()
        : 'Wedding Weekend Update';
    const messageBody =
      typeof body.body === 'string' && body.body.trim()
        ? body.body.trim()
        : 'We look forward to celebrating with you!';
    const scheduledFor =
      typeof body.scheduledFor === 'string' && body.scheduledFor.trim()
        ? body.scheduledFor.trim()
        : null;
    const isScheduled =
      Boolean(scheduledFor) && Date.parse(scheduledFor!) > Date.now() + 30_000;

    const nowIso = new Date().toISOString();
    const broadcastId = nextDemoId('demo-broadcast');
    let createdDto: ReturnType<typeof toBroadcastHistoryDto> | null = null;

    mutateActiveDataset((current) => {
      const eligibleGuests = current.guests.filter(
        (g) => !isDemoAddressCollectionOnly(g.partyTags)
      );
      const recipients: DemoBroadcastRecipientRecord[] = [];
      eligibleGuests.forEach((g, gIdx) => {
        const adultMembers = buildDemoHouseholdMembersForGuest(g).filter(
          (m) => m.role !== 'CHILD'
        );
        const seenDest = new Set<string>();
        adultMembers.forEach((m, mIdx) => {
          const dest =
            channel === 'SMS'
              ? m.phone?.trim()
              : m.email?.trim() || (mIdx === 0 ? g.email || `guest-${gIdx + 1}@example.com` : '');
          if (!dest) return;
          const lower = dest.toLowerCase();
          if (seenDest.has(lower)) return;
          seenDest.add(lower);
          recipients.push({
            id: `${broadcastId}-rcpt-${recipients.length + 1}`,
            broadcastId,
            invitationCodeId: g.id,
            recipientName: m.fullName || g.guestName,
            recipientEmail: channel === 'EMAIL' ? dest : null,
            ...(channel === 'SMS' ? { recipientPhone: dest } : {}),
            channel,
            status: isScheduled ? 'PENDING' : 'SENT',
            sentAt: isScheduled ? null : nowIso,
            viewedAt: null,
            errorMessage: null,
          });
        });
      });

      const record: DemoBroadcastRecord = {
        id: broadcastId,
        subject,
        body: messageBody,
        channel,
        status: isScheduled ? 'SCHEDULED' : 'SENT',
        audienceLabel: 'All Invited Households',
        recipientCount: recipients.length,
        sentCount: isScheduled ? 0 : recipients.length,
        failedCount: 0,
        viewedCount: 0,
        scheduledAt: isScheduled ? scheduledFor : null,
        sentAt: isScheduled ? null : nowIso,
        createdBy: 'Admin',
        createdAt: nowIso,
        updatedAt: nowIso,
        recipients,
      };
      createdDto = toBroadcastHistoryDto(record);
      return {
        ...current,
        broadcastMessages: [record, ...current.broadcastMessages],
      };
    });

    recordDemoAuditVersion(
      'BroadcastMessage',
      broadcastId,
      isScheduled ? 'SCHEDULE' : 'SEND',
      `${isScheduled ? 'Scheduled' : 'Sent'} ${channel} broadcast "${subject}"`,
      { id: broadcastId, subject, channel }
    );

    const responseDto = (createdDto ?? {}) as Record<string, unknown>;
    return jsonResponse({ success: true, ...responseDto, data: createdDto }, 201);
  }

  if (path === '/api/admin/broadcast/test-send' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const settings = getEffectiveDemoSettings();
    const payload = {
      success: true,
      simulated: true,
      channel: body.channel === 'SMS' ? 'SMS' : 'EMAIL',
      destination:
        typeof body.destination === 'string' && body.destination.trim()
          ? body.destination.trim()
          : settings.contactEmail,
      subject: typeof body.subject === 'string' ? body.subject : 'Test Broadcast',
    };
    return jsonResponse({ ...payload, data: payload });
  }

  if (path === '/api/admin/broadcast/test-connection' && method === 'POST') {
    const payload = {
      success: true,
      ok: true,
      provider: 'demo-local-sandbox',
      message: 'Demo messaging connection verified locally (zero external network calls).',
    };
    return jsonResponse({ ...payload, data: payload });
  }

  if (path === '/api/admin/broadcast/retry' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    const broadcastId = typeof body.broadcastId === 'string' ? body.broadcastId : '';
    const nowIso = new Date().toISOString();
    let retriedCount = 0;

    mutateActiveDataset((current) => ({
      ...current,
      broadcastMessages: current.broadcastMessages.map((msg) => {
        if (msg.id !== broadcastId) return msg;
        const nextRecipients = msg.recipients.map((r) => {
          if (r.status === 'FAILED' || r.status === 'PENDING') {
            retriedCount += 1;
            return { ...r, status: 'SENT' as const, sentAt: nowIso, errorMessage: null };
          }
          return r;
        });
        return {
          ...msg,
          status: 'SENT',
          failedCount: 0,
          sentCount: nextRecipients.length,
          sentAt: msg.sentAt || nowIso,
          updatedAt: nowIso,
          recipients: nextRecipients,
        };
      }),
    }));

    return jsonResponse({
      success: true,
      retriedCount,
      sentCount: retriedCount,
      data: { retriedCount, sentCount: retriedCount },
    });
  }

  const broadcastScheduleMatch = path.match(/^\/api\/admin\/broadcast\/schedule\/([^/]+)$/);
  if (broadcastScheduleMatch) {
    const scheduleId = decodeURIComponent(broadcastScheduleMatch[1]);
    if (method === 'DELETE') {
      mutateActiveDataset((current) => ({
        ...current,
        broadcastMessages: current.broadcastMessages.map((m) =>
          m.id === scheduleId
            ? { ...m, status: 'CANCELLED', updatedAt: new Date().toISOString() }
            : m
        ),
      }));
      return jsonResponse({
        success: true,
        id: scheduleId,
        status: 'CANCELLED',
        data: { id: scheduleId, status: 'CANCELLED', cancelled: true },
      });
    }
    if (method === 'PATCH' || method === 'PUT') {
      const body = await parseJsonBody(init, rawInput);
      let updatedMsg: DemoBroadcastRecord | null = null;
      mutateActiveDataset((current) => ({
        ...current,
        broadcastMessages: current.broadcastMessages.map((m) => {
          if (m.id !== scheduleId) return m;
          updatedMsg = {
            ...m,
            scheduledAt:
              typeof body.scheduledFor === 'string' ? body.scheduledFor : m.scheduledAt,
            updatedAt: new Date().toISOString(),
          };
          return updatedMsg;
        }),
      }));
      if (!updatedMsg) {
        return jsonResponse({ success: false, error: 'Scheduled broadcast not found.' }, 404);
      }
      const dto = toBroadcastHistoryDto(updatedMsg);
      return jsonResponse({ success: true, data: dto });
    }
  }

  const broadcastDetailMatch = path.match(/^\/api\/admin\/broadcast\/([^/]+)$/);
  if (broadcastDetailMatch && (method === 'GET' || method === 'DELETE')) {
    const broadcastId = decodeURIComponent(broadcastDetailMatch[1]);
    const existing = getActiveArchetypeDataset().broadcastMessages.find(
      (m) => m.id === broadcastId
    );
    if (!existing) {
      return jsonResponse({ success: false, error: 'Broadcast message not found.' }, 404);
    }
    if (method === 'DELETE') {
      mutateActiveDataset((current) => ({
        ...current,
        broadcastMessages: current.broadcastMessages.filter((m) => m.id !== broadcastId),
      }));
      return jsonResponse({ success: true, deletedId: broadcastId });
    }
    const dto = toBroadcastHistoryDto(existing);
    return jsonResponse({ success: true, data: dto });
  }

  if (path === '/api/cron/broadcasts' && (method === 'GET' || method === 'POST')) {
    return jsonResponse({ success: true, processed: 0, data: { processed: 0 } });
  }

  // 9. Seating Assignment, Auto-Assign & Export
  if (path === '/api/admin/seating/assign' && method === 'POST') {
    const body = await parseJsonBody(init, rawInput);
    if (Array.isArray(body.invitationCodeIds)) {
      const targetIds = new Set(
        body.invitationCodeIds.filter((id): id is string => typeof id === 'string')
      );
      const targetTableId = typeof body.tableId === 'string' ? body.tableId : null;
      const updatedGuests: InvitationCodeDTO[] = [];
      mutateActiveDataset((current) => {
        const occupiedOnTable = new Set<number>(
          targetTableId
            ? current.guests
              .filter((g) => g.tableId === targetTableId && !targetIds.has(g.id))
              .flatMap((g) => [
                ...(typeof g.seatNumber === 'number' ? [g.seatNumber] : []),
                ...(Array.isArray(g.plusOneSeatNumbers) ? g.plusOneSeatNumbers : []),
              ])
            : []
        );
        let nextSeat = 1;
        const claimSeat = () => {
          while (occupiedOnTable.has(nextSeat)) nextSeat += 1;
          occupiedOnTable.add(nextSeat);
          return nextSeat;
        };
        const nextGuests = current.guests.map((g) => {
          if (!targetIds.has(g.id)) return g;
          const members = buildDemoHouseholdMembersForGuest(g);
          if (!targetTableId) {
            const cleared: InvitationCodeDTO = {
              ...g,
              tableId: null,
              seatNumber: null,
              plusOneSeatNumbers: [],
              members: members.map((m) => ({ ...m, seatNumber: null })),
            };
            updatedGuests.push(cleared);
            return cleared;
          }
          const primarySeat = claimSeat();
          const plusOneCount = Math.max(0, g.plusOneAllocations ?? 0, members.length - 1);
          const plusOneSeatNumbers = Array.from({ length: plusOneCount }, () => claimSeat());
          const assigned: InvitationCodeDTO = {
            ...g,
            tableId: targetTableId,
            seatNumber: primarySeat,
            plusOneSeatNumbers,
            members: members.map((m, mIdx) => ({
              ...m,
              seatNumber: mIdx === 0 ? primarySeat : (plusOneSeatNumbers[mIdx - 1] ?? null),
            })),
          };
          updatedGuests.push(assigned);
          return assigned;
        });
        return { ...current, guests: nextGuests };
      });
      return jsonResponse({ success: true, data: { updatedGuests } });
    }
    if (Array.isArray(body.assignments)) {
      const updates = body.assignments as Array<{
        invitationCodeId?: string;
        tableId?: string | null;
        seatNumber?: number | null;
        plusOneSeatNumbers?: number[];
      }>;
      const updateMap = new Map(
        updates
          .filter((u) => typeof u.invitationCodeId === 'string')
          .map((u) => [u.invitationCodeId as string, u])
      );
      const updatedGuests: InvitationCodeDTO[] = [];
      mutateActiveDataset((current) => {
        const nextGuests = current.guests.map((g) => {
          const match = updateMap.get(g.id);
          if (!match) return g;
          const nextTableId = match.tableId ?? null;
          const primarySeat = nextTableId ? (match.seatNumber ?? null) : null;
          const compSeats =
            nextTableId && Array.isArray(match.plusOneSeatNumbers)
              ? match.plusOneSeatNumbers.filter((n): n is number => typeof n === 'number')
              : [];
          const members = buildDemoHouseholdMembersForGuest(g);
          const next: InvitationCodeDTO = {
            ...g,
            tableId: nextTableId,
            seatNumber: primarySeat,
            plusOneSeatNumbers: compSeats,
            members: members.map((m, mIdx) => ({
              ...m,
              seatNumber: !nextTableId
                ? null
                : mIdx === 0
                  ? primarySeat
                  : (compSeats[mIdx - 1] ?? null),
            })),
          };
          updatedGuests.push(next);
          return next;
        });
        return { ...current, guests: nextGuests };
      });
      return jsonResponse({ success: true, data: { updatedGuests } });
    }
    const guestId = String(body.invitationCodeId || '');
    const tableId = typeof body.tableId === 'string' ? body.tableId : null;
    const seatNumber = tableId && typeof body.seatNumber === 'number' ? body.seatNumber : null;
    const plusOneSeatNumbers =
      tableId && Array.isArray(body.plusOneSeatNumbers)
        ? body.plusOneSeatNumbers.filter((n): n is number => typeof n === 'number')
        : [];
    let updatedGuest: InvitationCodeDTO | null = null;
    mutateActiveDataset((current) => {
      const nextGuests = current.guests.map((g) => {
        if (g.id !== guestId) return g;
        const members = buildDemoHouseholdMembersForGuest(g);
        const next: InvitationCodeDTO = {
          ...g,
          tableId,
          seatNumber,
          plusOneSeatNumbers,
          members: members.map((m, mIdx) => ({
            ...m,
            seatNumber: !tableId
              ? null
              : mIdx === 0
                ? seatNumber
                : (plusOneSeatNumbers[mIdx - 1] ?? null),
          })),
        };
        updatedGuest = next;
        return next;
      });
      return { ...current, guests: nextGuests };
    });
    if (!updatedGuest) return jsonResponse({ error: 'Guest not found' }, 404);
    return jsonResponse({ success: true, data: updatedGuest });
  }

  if (path === '/api/admin/seating/auto-assign' && method === 'POST') {
    const assignedGuests: InvitationCodeDTO[] = [];
    let unassignedCount = 0;
    mutateActiveDataset((current) => {
      const guestTables = current.seatingTables.filter((t) => !isDemoLandmarkShape(t.shape));
      const occupiedByTable = new Map<string, Set<number>>();
      for (const table of guestTables) {
        occupiedByTable.set(table.id, new Set<number>());
      }
      for (const g of current.guests) {
        if (g.tableId && occupiedByTable.has(g.tableId)) {
          const set = occupiedByTable.get(g.tableId)!;
          if (typeof g.seatNumber === 'number') set.add(g.seatNumber);
          if (Array.isArray(g.plusOneSeatNumbers)) {
            for (const ps of g.plusOneSeatNumbers) set.add(ps);
          }
        }
      }
      const nextGuests = current.guests.map((g) => {
        if (g.tableId || isDemoAddressCollectionOnly(g.partyTags)) return g;
        const needed = 1 + Math.max(0, g.plusOneAllocations ?? 0);
        const targetTable = guestTables.find((t) => {
          const occupied = occupiedByTable.get(t.id)!;
          return t.capacity - occupied.size >= needed;
        });
        if (!targetTable) {
          unassignedCount += 1;
          return g;
        }
        const occupied = occupiedByTable.get(targetTable.id)!;
        const claim = () => {
          let s = 1;
          while (occupied.has(s)) s += 1;
          occupied.add(s);
          return s;
        };
        const seatNumber = claim();
        const plusOneSeatNumbers = Array.from({ length: needed - 1 }, () => claim());
        const members = buildDemoHouseholdMembersForGuest(g);
        const updated: InvitationCodeDTO = {
          ...g,
          tableId: targetTable.id,
          seatNumber,
          plusOneSeatNumbers,
          members: members.map((m, mIdx) => ({
            ...m,
            seatNumber: mIdx === 0 ? seatNumber : (plusOneSeatNumbers[mIdx - 1] ?? null),
          })),
        };
        assignedGuests.push(updated);
        return updated;
      });
      return { ...current, guests: nextGuests };
    });
    return jsonResponse({
      success: true,
      assignedCount: assignedGuests.length,
      unassignedCount,
      assignedGuests,
      data: {
        assignedCount: assignedGuests.length,
        unassignedCount,
        assignedGuests,
      },
    });
  }

  if (path === '/api/admin/seating/export' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const format = (url.searchParams.get('format') || 'csv').toLowerCase();
    const dateStamp = new Date().toISOString().slice(0, 10);
    const guestTables = dataset.seatingTables.filter(
      (t) => !isDemoLandmarkShape(t.shape) && t.capacity > 0
    );

    if (format === 'pdf' || format === 'place-cards' || format === 'escort-cards') {
      const title =
        format === 'place-cards'
          ? 'Reception Place Cards'
          : format === 'escort-cards'
            ? 'Reception Escort Cards'
            : 'Reception Seating Chart';
      const lines =
        format === 'escort-cards'
          ? guestTables
            .flatMap((t) =>
              dataset.guests
                .filter((g) => g.tableId === t.id)
                .map(
                  (g) =>
                    `${g.guestName} — ${t.name}${g.seatNumber ? ` (Seat ${g.seatNumber})` : ''}`
                )
            )
            .sort((a, b) => a.localeCompare(b))
          : guestTables.flatMap((t) => {
            const seated = dataset.guests
              .filter((g) => g.tableId === t.id)
              .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));
            return [
              `${t.name} (${seated.length}/${t.capacity} seated):`,
              ...(seated.length > 0
                ? seated.map((g) => `  Seat ${g.seatNumber ?? '-'}: ${g.guestName}`)
                : ['  (Unassigned Table)']),
            ];
          });
      const pdf = createMinimalPdfBytes(
        title,
        lines.length > 0 ? lines : ['No seated guests yet.']
      );
      return binaryResponse(pdf, 'application/pdf', `seating-${format}-${dateStamp}.pdf`);
    }

    if (format === 'meals' || format === 'meal-counts') {
      const csv = buildDemoCsv(
        [
          'Table Name',
          'Table Shape',
          'Capacity',
          'Seated Guests',
          'Entree Counts',
          'Dietary Counts',
        ],
        guestTables.map((t) => {
          const seated = dataset.guests.filter((g) => g.tableId === t.id);
          const headcount = seated.reduce(
            (sum, g) => sum + 1 + Math.max(0, g.plusOneAllocations ?? 0),
            0
          );
          const dietary = seated
            .map((g) => (g.dietaryNotes || '').trim())
            .filter(Boolean)
            .join('; ');
          return [
            t.name,
            t.shape,
            String(t.capacity),
            String(seated.length === 0 ? 0 : headcount),
            seated.length === 0 ? 'None specified' : `Unspecified: ${seated.length}`,
            dietary || 'None',
          ];
        })
      );
      return binaryResponse(csv, 'text/csv; charset=utf-8', `seating-meal-counts-${dateStamp}.csv`);
    }

    const rows: Array<Array<unknown>> = [];
    for (const table of guestTables) {
      const seated = dataset.guests
        .filter((g) => g.tableId === table.id)
        .sort((a, b) => (a.seatNumber ?? 999) - (b.seatNumber ?? 999));
      if (seated.length === 0) {
        rows.push([
          table.name,
          table.shape,
          String(table.capacity),
          '',
          '(Unassigned Table)',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
        ]);
        continue;
      }
      for (const g of seated) {
        const plusOneSeats = Array.isArray(g.plusOneSeatNumbers)
          ? [...g.plusOneSeatNumbers].sort((a, b) => a - b).join(', ')
          : '';
        rows.push([
          table.name,
          table.shape,
          String(table.capacity),
          g.seatNumber ?? '',
          g.guestName,
          g.dietaryNotes ?? '',
          [g.plusOneFirstName, g.plusOneLastName].filter(Boolean).join(' '),
          plusOneSeats,
          g.used ? 'Attending' : 'Pending',
          '',
          `Unspecified: ${seated.length}`,
          '',
        ]);
      }
    }
    const csv = buildDemoCsv(
      [
        'Table Name',
        'Table Shape',
        'Capacity',
        'Seat Number',
        'Guest Name',
        'Dietary Notes',
        'Plus-One Name',
        'Plus-One Seats',
        'Attendance',
        'Meal Selections',
        'Table Meal Counts',
        'Custom Answers',
      ],
      rows
    );
    return binaryResponse(csv, 'text/csv; charset=utf-8', `seating-roster-${dateStamp}.csv`);
  }

  // 10. Audit Version History & Snapshot Restore
  if (path === '/api/admin/versions' && method === 'GET') {
    const dataset = getActiveArchetypeDataset();
    const entityType = (url.searchParams.get('entityType') || '').trim();
    const entityId = (url.searchParams.get('entityId') || '').trim();
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10) || 50)
    );

    const filtered = dataset.snapshotVersions.filter((v) => {
      if (entityType && v.entityType !== entityType) return false;
      if (entityId && v.entityId !== entityId) return false;
      return true;
    });

    const total = filtered.length;
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const items = filtered.slice((page - 1) * limit, page * limit).map((v) => ({
      id: v.id,
      entityType: v.entityType,
      entityId: v.entityId,
      action: v.action,
      summary: v.summary,
      author: v.createdBy,
      createdBy: v.createdBy,
      createdAt: v.createdAt,
      data: sanitizeVersionData(v.data),
    }));

    const pagination = {
      total,
      totalCount: total,
      page,
      currentPage: page,
      limit,
      pageSize: limit,
      totalPages,
      isPaginated: true,
    };

    return jsonResponse({
      success: true,
      items,
      pagination,
      data: {
        items,
        pagination,
      },
    });
  }

  const versionRestoreMatch = path.match(/^\/api\/admin\/versions\/([^/]+)\/restore$/);
  if (versionRestoreMatch && method === 'POST') {
    const versionId = decodeURIComponent(versionRestoreMatch[1]);
    const restored = restoreDemoAuditVersion(versionId);
    if (!restored) {
      return jsonResponse({ success: false, error: 'Snapshot version not found.' }, 404);
    }
    return jsonResponse({
      success: true,
      restored,
      data: { restored },
    });
  }

  // 11. Database Maintenance Export & Import
  if (path === '/api/admin/maintenance/export' && method === 'GET') {
    const backup = buildDemoDatabaseBackup();
    const jsonBytes = JSON.stringify(backup, null, 2);
    return binaryResponse(
      jsonBytes,
      'application/json; charset=utf-8',
      `wedding-backup-${new Date().toISOString().slice(0, 10)}.json`
    );
  }

  if (path === '/api/admin/maintenance/import' && method === 'POST') {
    const formData = await parseFormData(init, rawInput);
    let rawBackup: Record<string, unknown> | null = null;

    if (formData) {
      const uploadedFile = formData.get('file') ?? formData.get('backup');
      if (typeof Blob !== 'undefined' && uploadedFile instanceof Blob) {
        try {
          const text = await uploadedFile.text();
          const parsed: unknown = JSON.parse(text);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            rawBackup = parsed as Record<string, unknown>;
          }
        } catch {
          return jsonResponse({ success: false, error: 'Invalid backup JSON file.' }, 400);
        }
      }
    } else {
      const body = await parseJsonBody(init, rawInput);
      if (Object.keys(body).length > 0) {
        rawBackup =
          body.backup && typeof body.backup === 'object' && !Array.isArray(body.backup)
            ? (body.backup as Record<string, unknown>)
            : body;
      }
    }

    if (!rawBackup) {
      return jsonResponse({ success: false, error: 'Backup payload is required.' }, 400);
    }

    // Validate full v2.0 backup files against DatabaseBackupSchema when schemaVersion is present
    if ('schemaVersion' in rawBackup || 'version' in rawBackup) {
      const { DatabaseBackupSchema, reviveDates } = await import('@/utils/backupValidation');
      const revived = reviveDates(rawBackup);
      const validation = DatabaseBackupSchema.safeParse(revived);
      if (!validation.success) {
        return jsonResponse(
          {
            success: false,
            error: validation.error.issues[0]?.message || 'Backup schema validation failed.',
          },
          400
        );
      }
    }

    const result = importDemoDatabaseBackup(rawBackup);
    return jsonResponse({
      success: true,
      ...result,
      data: result,
    });
  }

  return null;
}
